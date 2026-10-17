import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BOARD_SIZES,
  CAPS,
  DEFAULT_KOMI,
  PASS,
  levelCn,
  type AnalysisResult,
  type BoardSize,
  type Color,
  type EngineStatus,
  type HardwareReport,
  type Mode,
  type Vertex,
} from '@xingyi/shared';
import { Game } from '@xingyi/rules';
import { detectHardware, offlineMove, type CheckResult, type EngineManager } from '@xingyi/engine';
import {
  applyJumpExam,
  applyRankedGame,
  createProgress,
  defaultRankTable,
  loadProgressFile,
  normalizeProgress,
  normalizeRankTable,
  ratingOf,
  recordPlacementResult,
  saveProgressFile,
  type Progress,
  type RankTable,
  type RankedOutcome,
} from '@xingyi/rating';
import { loadConfig, saveConfig, type AppConfig } from './config.js';
import { Match } from './match.js';
import { parseSgf, toSgf } from './sgf.js';
import type { DataPaths } from './paths.js';

export class ServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CreateMatchOptions {
  mode: Mode;
  size?: BoardSize;
  komi?: number;
  level?: number;
  playerColor?: Color;
  /** 跳档考核：目标级 */
  examLevel?: number | null;
}

export interface Settlement {
  counted: boolean;
  /** 未计入时的原因（中文，直接展示） */
  reason?: string;
  won?: boolean;
  deltaR?: number;
  level?: number;
  levelCn?: string;
  levelChange?: 'up' | 'down' | null;
  streak?: number;
  provisional?: boolean;
  pendingPromotion?: boolean;
  notes?: string[];
  /** 定级赛第几盘 / 是否定级完成 */
  placement?: { stage: number; done: boolean; level: number };
}

const DEPTH_PRESETS = {
  quick: { minDurationMs: 180, maxDurationMs: 700, maxMoves: 5 },
  standard: { minDurationMs: 260, maxDurationMs: 1600, maxMoves: 6 },
  deep: { minDurationMs: 600, maxDurationMs: 4200, maxMoves: 8 },
} as const;

/**
 * 服务端唯一的"业务大脑"：对局生命周期、AI 调用、分析、进度结算、存档。
 * 路由只做参数校验与转发，不写业务判断（模式门禁一律读 CAPS）。
 */
export class GameService extends EventEmitter {
  private readonly paths: DataPaths;
  private readonly matches = new Map<string, Match>();
  cfg: AppConfig;
  progress: Progress;
  ranks: RankTable;
  engine: EngineManager;
  hardware: HardwareReport | null = null;

  constructor(paths: DataPaths, engine: EngineManager) {
    super();
    this.paths = paths;
    this.cfg = loadConfig(paths.configFile);
    this.progress =
      loadProgressFile(paths.progressFile, this.cfg.game.maxLevel) ??
      createProgress(this.cfg.playerName, this.cfg.game.maxLevel);
    this.ranks = this.loadRanks();
    this.engine = engine;
    this.engine.on('status', (status: EngineStatus) => this.emit('engine', status));
  }

  private loadRanks(): RankTable {
    try {
      const raw = JSON.parse(fs.readFileSync(this.paths.ranksFile, 'utf8'));
      return normalizeRankTable(raw, this.cfg.game.maxLevel);
    } catch {
      const table = defaultRankTable(this.cfg.game.maxLevel);
      try {
        fs.mkdirSync(this.paths.data, { recursive: true });
        fs.writeFileSync(this.paths.ranksFile, JSON.stringify(table, null, 2), 'utf8');
      } catch {
        /* 只读目录忽略 */
      }
      return table;
    }
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.paths.games, { recursive: true });
    if (this.engine.configured) {
      // 后台启动，不阻塞 HTTP 服务（用户能先看到界面与报错）
      void this.engine.start().catch(() => undefined);
    }
  }

  // ------------------------------------------------------------ 配置

  getConfig(): AppConfig {
    return this.cfg;
  }

  updateConfig(patch: unknown): AppConfig {
    const before = JSON.stringify(this.cfg.engine);
    this.cfg = { ...this.cfg, ...(patch as object) } as AppConfig;
    saveConfig(this.paths.configFile, this.cfg);
    this.engine.updateConfig(this.cfg.engine);
    if (JSON.stringify(this.cfg.engine) !== before) {
      void this.engine.restart().catch(() => undefined);
    }
    return this.cfg;
  }

  async probeHardware(): Promise<HardwareReport> {
    this.hardware = await detectHardware();
    return this.hardware;
  }

  async checkEngine(): Promise<CheckResult> {
    return this.engine.selfCheck();
  }

  async restartEngine(): Promise<EngineStatus> {
    return this.engine.restart();
  }

  // ------------------------------------------------------------ 对局

  createMatch(opts: CreateMatchOptions): Match {
    const mode = opts.mode;
    if (mode === 'lan') throw new ServiceError(501, '手谈（联机）还没做，P5 才上线');
    const caps = CAPS[mode];
    const size: BoardSize = BOARD_SIZES.includes(opts.size ?? 19) ? (opts.size as BoardSize) : 19;
    const komi = Number.isFinite(opts.komi) ? Number(opts.komi) : DEFAULT_KOMI;
    const playerColor: Color = opts.playerColor === 'W' ? 'W' : 'B';

    let level: number;
    let opponent: 'katago' | 'offline' = 'katago';
    let isPlacement = false;
    let examLevel: number | null = null;

    if (mode === 'ranked') {
      if (!this.engine.ready) {
        throw new ServiceError(
          409,
          '修习模式需要 KataGo 引擎：请先在「设置 → 引擎」里指定 katago 程序与模型，完成自检后再来。',
        );
      }
      const p = this.progress;
      isPlacement = !p.placement.done;
      level = isPlacement ? p.placement.current : p.level;
      if (!isPlacement && opts.examLevel) {
        examLevel = Math.min(this.ranks.maxLevel, Math.max(p.level + 1, Number(opts.examLevel)));
        level = examLevel;
      }
    } else {
      level = caps.allowLevelSelect ? Number(opts.level ?? 8) : 8;
      level = Math.min(this.ranks.maxLevel, Math.max(1, Math.round(level)));
      opponent = this.engine.ready ? 'katago' : 'offline';
    }

    const match = new Match({
      id: randomUUID().slice(0, 8),
      mode,
      size,
      komi,
      level,
      playerColor,
      opponent,
      isPlacement,
      examLevel,
    });
    this.matches.set(match.id, match);
    this.trimMatches();
    if (match.aiToMove()) void this.runAi(match);
    return match;
  }

  getMatch(id: string): Match {
    const m = this.matches.get(id);
    if (!m) throw new ServiceError(404, '对局不存在（可能服务重启过）');
    return m;
  }

  listMatches(): { id: string; mode: Mode; size: number; level: number; status: string; updatedAt: string }[] {
    return [...this.matches.values()].map((m) => ({
      id: m.id,
      mode: m.mode,
      size: m.size,
      level: m.level,
      status: m.game.status,
      updatedAt: m.updatedAt,
    }));
  }

  private trimMatches(): void {
    if (this.matches.size <= 12) return;
    const sorted = [...this.matches.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const old of sorted.slice(0, this.matches.size - 12)) {
      if (old.finished) this.matches.delete(old.id);
    }
  }

  humanMove(id: string, vertex: Vertex): Match {
    const m = this.getMatch(id);
    if (m.finished) throw new ServiceError(400, '这盘已经结束了');
    if (!m.humanToMove()) throw new ServiceError(400, '现在轮不到你');
    const color = m.opponent === 'human' ? m.game.toPlay : m.playerColor;
    const res = m.game.play(color, vertex);
    if (!res.ok) throw new ServiceError(400, res.message ?? '这一手不能下');
    m.touch();
    this.emit('game', m.snapshot());
    if (m.aiToMove()) void this.runAi(m);
    return m;
  }

  pass(id: string): Match {
    return this.humanMove(id, PASS);
  }

  undo(id: string, toPly?: number): Match {
    const m = this.getMatch(id);
    if (!CAPS[m.mode].allowUndo) throw new ServiceError(403, '修习模式不允许悔棋');
    const target = Number.isFinite(toPly) ? Number(toPly) : Math.max(0, m.game.ply - 1);
    m.game.undoTo(target);
    m.result = undefined;
    m.score = undefined;
    m.settlement = undefined;
    m.touch();
    this.emit('game', m.snapshot());
    if (m.aiToMove()) void this.runAi(m);
    return m;
  }

  /** 双方停手（界面的「终局」按钮）：直接进入待数子。 */
  endGame(id: string): Match {
    const m = this.getMatch(id);
    if (m.finished) throw new ServiceError(400, '这盘已经结束了');
    if (m.mode === 'ranked') {
      throw new ServiceError(403, '修习模式不能手动终局：要双方各自停手才算收官');
    }
    m.game.stop();
    m.aiThinking = false;
    m.touch();
    this.emit('game', m.snapshot());
    return m;
  }

  resign(id: string): Match {
    const m = this.getMatch(id);
    if (m.finished) throw new ServiceError(400, '这盘已经结束了');
    m.applyResign(m.playerColor);
    m.touch();
    m.settlement = this.settle(m);
    this.emit('game', m.snapshot());
    return m;
  }

  quit(id: string): Match {
    const m = this.getMatch(id);
    if (m.finished) return m;
    // 中途退出：修习算负（D33），自在无影响
    if (CAPS[m.mode].quitLoses) {
      m.applyQuit(m.playerColor);
      m.settlement = this.settle(m);
    } else {
      m.game.status = 'finished';
      m.result = { winner: null, reason: 'quit', text: '已退出（不计入进度）' };
    }
    m.touch();
    this.emit('game', m.snapshot());
    return m;
  }

  // ------------------------------------------------------------ AI

  private async runAi(m: Match): Promise<void> {
    if (m.aiThinking) return;
    m.aiThinking = true;
    this.emit('game', m.snapshot());
    try {
      let vertex: Vertex = PASS;
      let resign = false;
      if (m.opponent === 'katago' && this.engine.ready) {
        const out = await this.engine.genmove(m.aiColor, m.level, {
          size: m.size,
          komi: m.game.komi,
          moves: m.moveList(),
        });
        vertex = out.vertex;
        resign = out.resign;
      } else {
        vertex = offlineMove({
          size: m.size,
          grid: m.game.board.grid,
          toPlay: m.aiColor,
          level: m.level,
          seed: (m.id.charCodeAt(0) + m.game.ply + 1) * 7919,
          lastMove: m.game.lastMove,
        });
      }
      // 对局可能在这期间被叫停（点了「终局」或认输），别把 AI 的棋硬塞进去
      if (m.game.status !== 'playing') return;
      if (resign) {
        m.applyResign(m.aiColor);
        m.settlement = this.settle(m);
      } else {
        const res = m.game.play(m.aiColor, vertex);
        if (!res.ok) {
          throw new Error(`AI 给出了非法着法 ${vertex}：${res.message ?? ''}`);
        }
      }
    } catch (err) {
      this.emit('error', { matchId: m.id, message: (err as Error).message });
    } finally {
      m.aiThinking = false;
      m.touch();
      this.emit('game', m.snapshot());
    }
  }

  // ------------------------------------------------------------ 结算

  scorePreview(id: string, dead: Vertex[]) {
    const m = this.getMatch(id);
    return m.game.score(dead);
  }

  finishScored(id: string, dead: Vertex[]) {
    const m = this.getMatch(id);
    if (m.finished) throw new ServiceError(400, '这盘已经结算过了');
    if (m.game.status === 'playing') throw new ServiceError(400, '双方还没停手，不能数子');
    const { detail, text } = m.game.finishByScore(dead);
    m.applyScore(detail, text);
    m.touch();
    m.settlement = this.settle(m);
    this.emit('game', m.snapshot());
    return m;
  }

  private settle(m: Match): Settlement {
    this.saveSgf(m);
    const result = m.result;
    if (!result) return { counted: false, reason: '没有结果' };
    if (m.mode !== 'ranked') {
      return { counted: false, reason: m.mode === 'free' ? '自在模式不计入进度' : '联机不计入进度' };
    }
    if (m.opponent !== 'katago') {
      return { counted: false, reason: '离线对手不计入进度（棋力未校准）' };
    }

    const won = result.winner === m.playerColor;
    const signedDiff =
      result.winner === null ? 0 : (result.winner === m.playerColor ? 1 : -1) * (result.margin ?? 0);
    const moves = m.game.ply;

    let outcome: RankedOutcome | { done: boolean; level: number } | null = null;
    if (m.isPlacement) {
      outcome = recordPlacementResult(this.progress, this.ranks, won);
      this.saveProgress();
      const done = this.progress.placement.done;
      return {
        counted: true,
        won,
        level: this.progress.level,
        levelCn: levelCn(this.progress.level),
        streak: this.progress.streak,
        provisional: this.progress.provisional,
        pendingPromotion: false,
        notes: done ? [`定级完成：${levelCn(this.progress.level)}`] : ['定级赛继续'],
        placement: {
          stage: this.progress.placement.stage,
          done,
          level: this.progress.level,
        },
      };
    }

    if (m.examLevel) {
      outcome = applyJumpExam(this.progress, this.ranks, m.examLevel, won, {
        scoreDiff: signedDiff,
        moves,
        text: result.text,
      });
    } else {
      outcome = applyRankedGame(this.progress, {
        won,
        scoreDiff: signedDiff,
        moves,
        ranks: this.ranks,
        text: result.text,
      });
    }
    this.saveProgress();
    const ro = outcome as RankedOutcome;
    return {
      counted: true,
      won,
      deltaR: ro.rating.deltaR,
      level: this.progress.level,
      levelCn: levelCn(this.progress.level),
      levelChange: ro.change,
      streak: this.progress.streak,
      provisional: this.progress.provisional,
      pendingPromotion: this.progress.pendingPromotion,
      notes: ro.notes,
    };
  }

  private saveProgress(): void {
    saveProgressFile(this.paths.progressFile, this.paths.backups, this.progress);
    this.emit('progress', this.progressSummary());
  }

  private saveSgf(m: Match): void {
    try {
      fs.mkdirSync(this.paths.games, { recursive: true });
      const sgf = toSgf({
        size: m.size,
        komi: m.game.komi,
        moves: m.moveList(),
        setup: { black: m.game.setup.black, white: m.game.setup.white },
        playerBlack: m.playerColor === 'B' ? this.progress.playerName : `KataGo ${levelCn(m.level)}`,
        playerWhite: m.playerColor === 'W' ? this.progress.playerName : `KataGo ${levelCn(m.level)}`,
        result: this.reSgf(m.result),
        comment: `${m.mode === 'ranked' ? '修习' : '自在'} · 对手 ${levelCn(m.level)} · ${m.opponent}`,
      });
      fs.writeFileSync(path.join(this.paths.games, `${m.id}.sgf`), sgf, 'utf8');
    } catch {
      /* 存谱失败不影响对局 */
    }
  }

  private reSgf(result?: { winner: Color | null; margin?: number; reason: string }): string | null {
    if (!result?.winner) return null;
    if (result.reason === 'resign' || result.reason === 'quit') return `${result.winner}+R`;
    return `${result.winner}+${result.margin ?? 0}`;
  }

  // ------------------------------------------------------------ 分析

  async analyze(id: string, depth?: 'quick' | 'standard' | 'deep'): Promise<
    { available: true; result: AnalysisResult } | { available: false; reason: string }
  > {
    const m = this.getMatch(id);
    const caps = CAPS[m.mode];
    if (!caps.allowAnalysis) return { available: false, reason: '修习模式不可用分析（等于开卷考试）' };
    if (!this.engine.ready) {
      return { available: false, reason: '引擎未就绪：在「设置 → 引擎」完成配置后才有实时推荐' };
    }
    const preset = DEPTH_PRESETS[depth ?? this.cfg.ui.analysisDepth] ?? DEPTH_PRESETS.standard;
    const result = await this.engine.analyze({
      size: m.size,
      komi: m.game.komi,
      moves: m.moveList(),
      turn: m.game.toPlay,
      level: Math.max(11, m.level),
      ...preset,
    });
    if (!result) return { available: false, reason: '引擎这次没给出结果（超时或局面异常），再试一次' };
    return { available: true, result };
  }

  // ------------------------------------------------------------ 导入

  importSgf(text: string): { match: Match; variations: number; warnings: string[] } {
    const parsed = parseSgf(text);
    if (!BOARD_SIZES.includes(parsed.size as BoardSize)) {
      throw new ServiceError(400, `只支持 9 / 13 / 19 路棋谱，这个谱是 ${parsed.size} 路`);
    }
    const size = parsed.size as BoardSize;
    const match = new Match({
      id: randomUUID().slice(0, 8),
      mode: 'free',
      size,
      komi: Number.isFinite(parsed.komi) ? parsed.komi : DEFAULT_KOMI,
      level: 8,
      playerColor: 'B',
      opponent: 'human',
      setup: parsed.setup,
      toPlay: parsed.firstPlayer,
    });
    const warnings: string[] = [];
    let illegal = 0;
    for (const mv of parsed.mainLine) {
      const res = match.game.play(mv.color, mv.vertex);
      if (!res.ok) {
        illegal += 1;
        warnings.push(`第 ${match.game.ply + 1} 手（${mv.color}）无法还原：${res.message ?? '非法着法'}，已停在此处`);
        break;
      }
    }
    if (parsed.variationCount > 0) {
      warnings.push(`棋谱含 ${parsed.variationCount} 个变化分支，当前界面只展示主线（P1 后续补树视图）`);
    }
    if (illegal === 0 && parsed.mainLine.length === 0) warnings.push('这个棋谱没有可还原的着法');
    this.matches.set(match.id, match);
    match.touch();
    return { match, variations: parsed.variationCount, warnings };
  }

  // ------------------------------------------------------------ 进度

  progressSummary() {
    const p = this.progress;
    return {
      ...p,
      history: p.history.slice(-30),
      levelCn: levelCn(p.level),
      maxLevel: this.ranks.maxLevel,
      nextLevelRating: p.level < this.ranks.maxLevel ? ratingOf(this.ranks, p.level + 1) : null,
      ranksCalibrated: this.ranks.calibrated,
    };
  }

  renamePlayer(name: string): void {
    const clean = String(name ?? '').trim().slice(0, 12);
    if (!clean) throw new ServiceError(400, '名字不能为空');
    this.progress.playerName = clean;
    this.cfg.playerName = clean;
    saveConfig(this.paths.configFile, this.cfg);
    this.saveProgress();
  }

  /**
   * 评级沙盘：在**存档副本**上跑 N 盘，回放等级/分数变化。
   * 用途：等级校准分还没实测之前，让用户先判断"升降级手感"合不合理。
   * 绝不写 progress.json。
   */
  simulateRanked(opts: { pattern: 'win' | 'alternate' | 'lose'; games: number; startLevel?: number }): {
    start: { level: number; R: number; RD: number };
    timeline: { game: number; won: boolean; R: number; deltaR: number; level: number; change: 'up' | 'down' | null; pending: boolean }[];
    end: { level: number; R: number; RD: number; levelCn: string };
  } {
    const total = Math.min(60, Math.max(1, Math.round(opts.games || 10)));
    const level = Math.min(this.ranks.maxLevel, Math.max(1, Math.round(opts.startLevel ?? this.progress.level)));
    const p: Progress = structuredClone(this.progress);
    p.placement.done = true;
    p.level = level;
    p.R = ratingOf(this.ranks, level);
    p.RD = 220;
    p.levelGames = 0;
    p.levelWins = 0;
    p.streak = 0;
    p.protection = 0;
    p.demotionBuffer = 0;
    p.promotionCooldown = 0;
    p.provisional = p.gamesTotal < 10;
    p.history = [];
    const start = { level: p.level, R: p.R, RD: p.RD };
    const timeline = [];
    for (let i = 0; i < total; i++) {
      const won =
        opts.pattern === 'win' ? true : opts.pattern === 'lose' ? false : i % 3 !== 2;
      const out = applyRankedGame(p, {
        won,
        scoreDiff: won ? 8 : -8,
        moves: 180,
        ranks: this.ranks,
        now: new Date(Date.now() + i * 1000),
      });
      p.history = [];
      timeline.push({
        game: i + 1,
        won,
        R: Math.round(p.R * 10) / 10,
        deltaR: out.rating.deltaR,
        level: p.level,
        change: out.change,
        pending: out.pendingPromotion,
      });
    }
    return {
      start,
      timeline,
      end: { level: p.level, R: Math.round(p.R * 10) / 10, RD: Math.round(p.RD * 10) / 10, levelCn: levelCn(p.level) },
    };
  }

  /** 仅供开发/演示：重置进度（需要显式 confirmation 字符串） */
  resetProgress(confirm: string): void {
    if (confirm !== 'RESET') throw new ServiceError(400, '需要确认参数 confirm=RESET');
    this.progress = createProgress(this.cfg.playerName, this.cfg.game.maxLevel);
    this.saveProgress();
  }

  normalizeOnBoot(): void {
    this.progress = normalizeProgress(this.progress, this.cfg.game.maxLevel);
  }

  /** 供测试与"空局面"用：从任意盘面建一局（摆子分析） */
  createFromSetup(size: BoardSize, grid: number[], toPlay: Color, komi = DEFAULT_KOMI): Match {
    const setup = { black: [] as number[], white: [] as number[] };
    grid.forEach((c, i) => {
      if (c === 1) setup.black.push(i);
      if (c === 2) setup.white.push(i);
    });
    const m = new Match({
      id: randomUUID().slice(0, 8),
      mode: 'free',
      size,
      komi,
      level: 8,
      playerColor: toPlay,
      opponent: 'human',
      setup,
    });
    this.matches.set(m.id, m);
    return m;
  }
}

/** 便于测试：不启动引擎的纯规则对局 */
export function createBareGame(size: number, komi: number): Game {
  return new Game({ size, komi });
}
