import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { AnalysisResult, Backend, Color, EngineStatus, Vertex } from '@xingyi/shared';
import { PASS, gtpToVertex, vertexToGtp } from '@xingyi/shared';
import { GtpSession } from './gtp.js';
import { buildGtpArgs, levelParams, type EngineSpawnConfig } from './params.js';
import { createAccumulator, feedLine, finalizeCandidates } from './analyze.js';

export interface EngineConfig {
  binaryPath: string | null;
  backend: Backend;
  modelPath: string | null;
  humanModelPath: string | null;
  configPath: string | null;
  extraArgs: string[];
  /**
   * 直接覆盖命令行参数（高级用法 / 测试用）。
   * 正常留 null，由 buildGtpArgs 生成 `gtp -model ... -config ...`。
   */
  argvOverride?: string[] | null;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  binaryPath: null,
  backend: 'cuda',
  modelPath: null,
  humanModelPath: null,
  configPath: null,
  extraArgs: [],
  argvOverride: null,
};

export interface CheckStep {
  key: string;
  label: string;
  ok: boolean;
  /** 失败原因 / 成功说明（中文） */
  message: string;
}

export interface CheckResult {
  ok: boolean;
  steps: CheckStep[];
  version: string | null;
  models: string[];
  humanSL: boolean;
}

export interface MoveLike {
  color: Color;
  vertex: Vertex;
}

export interface AnalyzeRequest {
  size: number;
  komi: number;
  moves: MoveLike[];
  turn: Color;
  level: number;
  /** 最短分析时长（出第一版结果就返回） */
  minDurationMs?: number;
  /** 最长分析时长 */
  maxDurationMs?: number;
  intervalMs?: number;
  maxMoves?: number;
  /** 假设对手水平（playoutDoublingAdvantage），null = 同水平 */
  assumeLevel?: number | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 引擎门面：进程守护 + 状态机 + 局面同步 + 分析节流。
 * 对弈与分析共用同一个进程，**请求串行**（PLAN §5 进程模型）。
 */
export class EngineManager extends EventEmitter {
  private config: EngineConfig;
  private session: GtpSession | null = null;
  private synced: { size: number; komi: number; moves: MoveLike[] } | null = null;
  private version: string | null = null;
  status: EngineStatus;

  constructor(config: Partial<EngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.status = {
      state: 'unconfigured',
      backend: this.config.backend,
      binaryPath: this.config.binaryPath,
      modelPath: this.config.modelPath,
      humanModelPath: this.config.humanModelPath,
      version: null,
      error: null,
      offlineAvailable: true,
      pid: null,
    };
  }

  getConfig(): EngineConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<EngineConfig>): void {
    this.config = { ...this.config, ...partial };
    this.setStatus({
      backend: this.config.backend,
      binaryPath: this.config.binaryPath,
      modelPath: this.config.modelPath,
      humanModelPath: this.config.humanModelPath,
    });
  }

  get configured(): boolean {
    return Boolean(this.config.binaryPath && this.config.modelPath);
  }

  get ready(): boolean {
    return this.status.state === 'ready' || this.status.state === 'thinking' || this.status.state === 'analyzing';
  }

  private setStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  /** 启动并做最小自检（name / version）。已在跑就直接返回，避免重复 spawn 出两个引擎。 */
  async start(): Promise<EngineStatus> {
    if (this.session?.running) return this.status;
    if (!this.configured) {
      this.setStatus({ state: 'unconfigured', error: '还没有配置 katago 与模型文件' });
      return this.status;
    }
    const binary = this.config.binaryPath!;
    if (!fs.existsSync(binary)) {
      this.setStatus({ state: 'crashed', error: `找不到引擎文件：${binary}` });
      return this.status;
    }
    this.setStatus({ state: 'starting', error: null });
    const spawnCfg: EngineSpawnConfig = {
      binaryPath: binary,
      backend: this.config.backend,
      modelPath: this.config.modelPath!,
      humanModelPath: this.config.humanModelPath,
      configPath: this.config.configPath,
      extraArgs: this.config.extraArgs,
    };
    const session = new GtpSession({
      binary,
      args: this.config.argvOverride ?? buildGtpArgs(spawnCfg),
    });
    this.session = session;
    this.synced = null;
    session.on('stderr', (chunk: string) => this.emit('stderr', chunk));
    session.on('exit', (_code: number | null, _sig: string | null, stopped: boolean) => {
      if (stopped) return;
      this.session = null;
      this.synced = null;
      this.setStatus({ state: 'crashed', pid: null, error: '引擎进程意外退出，可以点「重启引擎」' });
    });
    try {
      session.start();
      const name = await session.send('name', 20000);
      const version = await session.send('version', 10000).catch(() => '');
      this.version = version || null;
      this.setStatus({
        state: 'ready',
        version: version || name,
        pid: session.pid,
        error: null,
      });
    } catch (err) {
      this.setStatus({ state: 'crashed', error: (err as Error).message, pid: session.pid });
      session.stop();
      this.session = null;
    }
    return this.status;
  }

  async stop(): Promise<void> {
    this.session?.stop();
    this.session = null;
    this.synced = null;
    this.setStatus({ state: 'unconfigured', pid: null });
  }

  async restart(): Promise<EngineStatus> {
    await this.stop();
    return this.start();
  }

  /** 三步向导要用的逐项校验（PLAN §18.1）。 */
  async selfCheck(): Promise<CheckResult> {
    const steps: CheckStep[] = [];
    const binaryOk = Boolean(this.config.binaryPath && fs.existsSync(this.config.binaryPath));
    steps.push({
      key: 'binary',
      label: 'katago 可执行文件',
      ok: binaryOk,
      message: binaryOk ? this.config.binaryPath! : '找不到文件，请重新选择 katago.exe / katago',
    });
    const modelOk = Boolean(this.config.modelPath && fs.existsSync(this.config.modelPath));
    steps.push({
      key: 'model',
      label: '主模型',
      ok: modelOk,
      message: modelOk ? this.config.modelPath! : '找不到主模型（b18c384nbt*.bin.gz）',
    });
    const humanOk = Boolean(this.config.humanModelPath && fs.existsSync(this.config.humanModelPath));
    steps.push({
      key: 'humanModel',
      label: 'human SL 模型（低段必需）',
      ok: humanOk,
      message: humanOk
        ? this.config.humanModelPath!
        : '未配置 human 模型：1~11 级将退回主模型低 visits，棋风会像随机犯蠢（官方说明）',
    });

    if (!binaryOk || !modelOk) {
      return { ok: false, steps, version: null, models: [], humanSL: false };
    }

    const status = await this.start();
    if (status.state !== 'ready') {
      steps.push({ key: 'spawn', label: '引擎启动', ok: false, message: status.error ?? '启动失败' });
      return { ok: false, steps, version: null, models: [], humanSL: false };
    }
    const session = this.session!;
    let engineOk = true;
    try {
      await session.send('boardsize 19', 15000);
      await session.send('clear_board', 10000);
      steps.push({ key: 'board', label: '引擎可建局', ok: true, message: '引擎已就绪' });
      this.synced = { size: 19, komi: 7.5, moves: [] };
    } catch (err) {
      engineOk = false;
      steps.push({ key: 'board', label: '引擎可建局', ok: false, message: (err as Error).message });
    }
    let models: string[] = [];
    let humanSL = false;
    try {
      const raw = await session.send('kata-get-models', 10000);
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      models = parsed.map((m) => String(m.name ?? m.file ?? 'model'));
      humanSL = parsed.some((m) => Boolean(m.usesHumanSLProfile));
      steps.push({
        key: 'humanSL',
        label: 'human SL 已加载',
        ok: humanSL || !this.config.humanModelPath,
        message: humanSL ? 'human 模型可用于 1~11 级' : '未检测到 human 模型能力',
      });
    } catch {
      steps.push({
        key: 'humanSL',
        label: 'human SL 已加载',
        ok: !this.config.humanModelPath,
        message: '引擎不支持 kata-get-models，无法确认 human 模型（旧版引擎）',
      });
    }
    const ok = engineOk;
    return { ok, steps, version: this.version, models, humanSL };
  }

  private async syncPosition(size: number, komi: number, moves: MoveLike[]): Promise<void> {
    const session = this.session;
    if (!session) throw new Error('引擎未启动');
    const prefix =
      this.synced &&
      this.synced.size === size &&
      this.synced.komi === komi &&
      moves.length >= this.synced.moves.length &&
      this.synced.moves.every((m, i) => m.color === moves[i]!.color && m.vertex === moves[i]!.vertex);

    if (!prefix) {
      await session.sendNow(`boardsize ${size}`, 15000);
      await session.sendNow('clear_board', 10000);
      await session.sendNow(`komi ${komi}`, 10000);
      this.synced = { size, komi, moves: [] };
    }
    const start = this.synced!.moves.length;
    for (let i = start; i < moves.length; i++) {
      const m = moves[i]!;
      await session.sendNow(`play ${m.color} ${vertexToGtp(size, m.vertex)}`, 10000);
      this.synced!.moves.push(m);
    }
  }

  private async tryCmd(cmd: string, timeoutMs = 8000): Promise<boolean> {
    if (!this.session) return false;
    try {
      await this.session.sendNow(cmd, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /** 按级数下发参数。human SL 相关失败不致命（可能没装 human 模型）。 */
  private async applyLevelParams(level: number, assumeLevel?: number | null): Promise<void> {
    const p = levelParams(level);
    await this.tryCmd(`kata-set-param maxVisits ${p.maxVisits}`);
    if (p.profile) {
      if (this.config.humanModelPath) {
        // 实测：只设 humanSLProfile 并不会改变棋——humanSLChosenMoveProp 默认是 0，
        // 意思是「不从人类模型选点」。必须显式设成 1 才真的走 human SL。
        await this.tryCmd(
          `kata-set-params ${JSON.stringify({
            humanSLProfile: p.profile,
            humanSLChosenMoveProp: 1.0,
            humanSLChosenMovePiklLambda: 1e9,
            humanSLChosenMoveIgnorePass: true,
          })}`,
        );
      }
    } else {
      await this.tryCmd(
        `kata-set-params ${JSON.stringify({ humanSLProfile: '', humanSLChosenMoveProp: 0 })}`,
      );
    }
    if (typeof assumeLevel === 'number' && Number.isFinite(assumeLevel)) {
      const diff = level - assumeLevel;
      const pda = Math.max(-1.5, Math.min(1.5, diff * 0.1));
      await this.tryCmd(`kata-set-param playoutDoublingAdvantage ${pda.toFixed(3)}`);
    } else {
      await this.tryCmd('kata-set-param playoutDoublingAdvantage 0');
    }
  }

  /** AI 走子。返回 PASS 表示停一手；resign 单独标记。 */
  async genmove(
    color: Color,
    level: number,
    position: { size: number; komi: number; moves: MoveLike[] },
    timeoutMs = 60000,
  ): Promise<{ vertex: Vertex; resign: boolean; raw: string }> {
    const session = this.session;
    if (!session || !this.ready) throw new Error('引擎未就绪');
    return session.exclusive(async () => {
      this.setStatus({ state: 'thinking' });
      try {
        await this.syncPosition(position.size, position.komi, position.moves);
        await this.applyLevelParams(level);
        const raw = (await session.sendNow(`genmove ${color}`, timeoutMs)).trim();
        const token = raw.split(/\s+/)[0] ?? 'pass';
        if (/^resign$/i.test(token)) return { vertex: PASS, resign: true, raw };
        const vertex = gtpToVertex(position.size, token);
        if (vertex !== PASS) {
          this.synced?.moves.push({ color, vertex });
        } else {
          this.synced?.moves.push({ color, vertex: PASS });
        }
        return { vertex, resign: false, raw };
      } finally {
        this.setStatus({ state: 'ready' });
      }
    });
  }

  /**
   * 实时分析：`kata-analyze` 是异步流，收到任何新命令即终止（PLAN §7.3）。
   * 拿到第一版有 visit 的结果就返回，兼顾"≤300ms 出结果"。
   */
  async analyze(req: AnalyzeRequest): Promise<AnalysisResult | null> {
    const session = this.session;
    if (!session || !this.ready) return null;
    const {
      size,
      komi,
      moves,
      turn,
      level,
      minDurationMs = 260,
      maxDurationMs = 1600,
      intervalMs = 100,
      maxMoves = 6,
      assumeLevel = null,
    } = req;

    return session.exclusive(async () => {
      this.setStatus({ state: 'analyzing' });
      const started = Date.now();
      const acc = createAccumulator(size, turn);
      try {
        await this.syncPosition(size, komi, moves);
        await this.applyLevelParams(level, assumeLevel);
        await this.tryCmd('kata-set-param analysisIgnorePreRootHistory true');
        session.beginAnalysis((line) => feedLine(acc, line));
        const cs = Math.max(10, Math.round(intervalMs / 10));
        session.writeRaw(
          `kata-analyze ${turn} interval ${cs} maxmoves ${maxMoves} ownership true rootInfo true`,
        );
        for (;;) {
          const elapsed = Date.now() - started;
          if (elapsed >= maxDurationMs) break;
          if (elapsed >= minDurationMs && acc.candidates.size > 0) break;
          await sleep(40);
        }
        session.endAnalysis();
        await sleep(60); // 让最后一批行落进缓冲
        const candidates = finalizeCandidates(acc, maxMoves);
        if (candidates.length === 0) return null;
        return {
          turn,
          fingerprint: `${size}:${komi}:${turn}:${moves.map((m) => `${m.color}${m.vertex}`).join(',')}`,
          rootVisits: acc.rootVisits,
          candidates,
          ownership: acc.ownership,
          source: 'katago',
          elapsedMs: Date.now() - started,
        } satisfies AnalysisResult;
      } finally {
        session.endAnalysis();
        this.setStatus({ state: 'ready' });
      }
    });
  }
}
