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
  type ReviewPoint,
  type ReviewResult,
  type RoomSeat,
  type TimeControl,
  type Vertex,
} from '@xingyi/shared';
import { Game } from '@xingyi/rules';
import { Room, RoomError, makeRoomCode, type RoomSettings } from './room.js';
import { DEFAULT_TIME_CONTROL } from './clock.js';
import { handicapKomi, handicapStones } from './handicap.js';
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
  /** 让子数（2~9；0/1 = 不让） */
  handicap?: number;
  /** 时间制；不传 = 默认 10 分 + 3×30 秒，显式 null = 不限时 */
  timeControl?: TimeControl | null;
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

// 分析强度与「对局等级」解耦：等级表的下限档位访问量很低（5~160），借它分析会出垃圾。
const DEPTH_PRESETS = {
  quick: { minDurationMs: 180, maxDurationMs: 700, maxMoves: 5, visits: 200 },
  standard: { minDurationMs: 260, maxDurationMs: 1600, maxMoves: 6, visits: 400 },
  deep: { minDurationMs: 600, maxDurationMs: 4200, maxMoves: 8, visits: 900 },
} as const;

/** 复盘只算前 200 手，再长就截断（引擎逐局面分析，越往后越贵） */
const REVIEW_LIMIT = 200;
/** 每次请求推进多少个局面：19 路约 200ms/局面 → 一块 ≈ 2.4 秒，前端进度条走得比较顺 */
const REVIEW_CHUNK = 12;
/** 算完的作业留 10 分钟，供前端补拿最终快照 */
const REVIEW_JOB_TTL_MS = 10 * 60 * 1000;

interface ReviewJob {
  id: string;
  size: BoardSize;
  komi: number;
  moves: { color: Color; vertex: Vertex }[];
  /** 要评估的局面数上限（手数，截断到 REVIEW_LIMIT） */
  limit: number;
  /** 下一个待评估的局面下标 k（0..limit） */
  next: number;
  /** evals[k] = 第 k 个局面（已下 k 手）的黑方目差/胜率 */
  evals: { lead: number | null; wr: number | null }[];
  startedAt: number;
  running: boolean;
  cancelled: boolean;
}

/**
 * 复盘作业表：按对局 id 存一份，分块推进。
 * 放模块级是因为前端每轮询一次就是一次新请求，服务实例只有一个，语义上等于缓存。
 */
const reviewJobs = new Map<string, ReviewJob>();

function pruneReviewJobs(now: number): void {
  for (const [key, job] of reviewJobs) {
    if (!job.running && now - job.startedAt > REVIEW_JOB_TTL_MS) reviewJobs.delete(key);
  }
}

/** 清掉全部复盘作业（测试与重启用） */
export function clearReviewJobs(): void {
  reviewJobs.clear();
}

/** 把作业的已评估局面拼成前端要的结果（未评估到的局面不出点） */
function buildReviewResult(job: ReviewJob): ReviewResult {
  const doneMoves = Math.max(0, job.next - 1);
  const points: ReviewPoint[] = [];
  const byColor: ReviewResult['summary']['byColor'] = {
    B: { good: 0, normal: 0, mistake: 0, unknown: 0 },
    W: { good: 0, normal: 0, mistake: 0, unknown: 0 },
  };
  for (let i = 0; i < doneMoves; i++) {
    const mv = job.moves[i]!;
    const before = job.evals[i]!;
    const after = job.evals[i + 1]!;
    let loss: number | null = null;
    let lossWr: number | null = null;
    if (before.lead !== null && after.lead !== null) {
      const delta = after.lead - before.lead; // 黑方目差变化
      loss = Math.max(0, mv.color === 'B' ? -delta : delta);
      loss = Math.round(loss * 10) / 10;
    }
    if (before.wr !== null && after.wr !== null) {
      const dwr = mv.color === 'B' ? before.wr - after.wr : after.wr - before.wr;
      lossWr = Math.round(Math.max(0, dwr) * 1000) / 1000;
    }
    // 用目差判档：胜率在"已经输定"时会饱和（一直 0%，后面下多臭都不掉），目差不会
    const scale = job.size === 19 ? 1 : job.size === 13 ? 0.7 : 0.5;
    const label: ReviewPoint['label'] =
      loss === null ? 'unknown' : loss <= 1 * scale ? 'good' : loss <= 3 * scale ? 'normal' : 'mistake';
    byColor[mv.color][label] += 1;
    points.push({
      ply: i + 1,
      winrateBlack: before.wr,
      scoreLeadBlack: before.lead,
      loss,
      lossWinrate: lossWr,
      label,
    });
  }
  const summary = {
    ...byColor.B,
    good: byColor.B.good + byColor.W.good,
    normal: byColor.B.normal + byColor.W.normal,
    mistake: byColor.B.mistake + byColor.W.mistake,
    unknown: byColor.B.unknown + byColor.W.unknown,
    byColor,
  };
  return {
    size: job.size,
    komi: job.komi,
    points,
    summary,
    truncated: job.moves.length > job.limit,
    progress: {
      done: job.next,
      total: job.limit + 1,
      running: job.running,
      cancelled: job.cancelled,
      elapsedMs: Date.now() - job.startedAt,
    },
  };
}

/**
 * 服务端唯一的"业务大脑"：对局生命周期、AI 调用、分析、进度结算、存档。
 * 路由只做参数校验与转发，不写业务判断（模式门禁一律读 CAPS）。
 */
export class GameService extends EventEmitter {
  private readonly paths: DataPaths;
  private readonly matches = new Map<string, Match>();
  private readonly rooms = new Map<string, Room>();
  private clockTimer: ReturnType<typeof setInterval> | null = null;
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
    this.startClockTicker();
    if (this.engine.configured) {
      // 后台启动，不阻塞 HTTP 服务（用户能先看到界面与报错）
      void this.engine.start().catch(() => undefined);
    }
  }

  /** 每秒推一次带计时的快照；超时直接判负并按模式结算 */
  private startClockTicker(): void {
    if (this.clockTimer) return;
    this.clockTimer = setInterval(() => {
      for (const m of this.matches.values()) {
        if (!m.clock || m.game.status !== 'playing') continue;
        const flagged = m.clock.tick();
        if (flagged) {
          m.applyTimeout(flagged);
          m.aiThinking = false;
          m.touch();
          m.settlement = this.settle(m);
          this.emitGame(m);
          continue;
        }
        this.emitGame(m);
      }
      // 手谈房间的棋钟（W2）：每秒推一次快照，两边的钟才会走；超时判负在 snapshot 里做
      for (const r of this.rooms.values()) {
        if (!r.clock || r.status !== 'playing') continue;
        this.emit('room', r.snapshot());
      }
    }, 1000);
    // 别让计时循环把进程钉死（服务正常退出时允许结束）
    this.clockTimer.unref?.();
  }

  dispose(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
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
    const requestedSize = opts.size ?? 19;
    const size: BoardSize = BOARD_SIZES.includes(requestedSize) ? requestedSize : 19;
    const handicap = Math.max(0, Math.min(9, Math.round(Number(opts.handicap ?? 0))));
    const baseKomi = Number.isFinite(opts.komi) ? Number(opts.komi) : DEFAULT_KOMI;
    const komi = handicapKomi(handicap, baseKomi);
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

    // 时间制：显式传 null 才是不限时，不传按默认 10 分 + 3×30 秒
    const timeControl: TimeControl | null =
      opts.timeControl === null ? null : (opts.timeControl ?? DEFAULT_TIME_CONTROL);

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
      handicap: handicap >= 2 ? handicap : 0,
      // 让子局：黑先摆子，白先走（Game 会根据 setup 自动把 toPlay 定成白）
      setup: handicap >= 2 ? { black: handicapStones(size, handicap), white: [] } : undefined,
      timeControl,
    });
    this.matches.set(match.id, match);
    this.trimMatches();
    if (match.aiToMove()) void this.runAi(match);
    return match;
  }

  /** 唯一的对局推送出口：先把计时器对齐到当前轮次，再推快照 */
  private emitGame(m: Match): void {
    if (m.clock) {
      if (m.game.status === 'playing') m.clock.switchTo(m.game.toPlay);
      else m.clock.pause();
    }
    this.emit('game', m.snapshot());
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
    m.redo = [];
    m.touch();
    this.emitGame(m);
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
    const from = Math.max(0, Math.min(target, m.game.ply));
    const removed = m.game.moves.slice(from);
    m.game.undoTo(from);
    m.redo = [...removed, ...m.redo];
    m.result = undefined;
    m.score = undefined;
    m.settlement = undefined;
    m.touch();
    this.emitGame(m);
    if (m.aiToMove()) void this.runAi(m);
    return m;
  }

  redo(id: string): Match {
    const m = this.getMatch(id);
    if (!CAPS[m.mode].allowUndo) throw new ServiceError(403, '修习模式不允许重做');
    const next = m.redo[0];
    if (!next) throw new ServiceError(400, '没有可重做的着法');
    if (next.color !== m.game.toPlay) throw new ServiceError(400, '重做顺序对不上，先重试一步');
    const res = m.game.play(next.color, next.vertex);
    if (!res.ok) throw new ServiceError(400, '这一手已经不能重做了');
    m.redo.shift();
    m.touch();
    this.emitGame(m);
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
    this.emitGame(m);
    return m;
  }

  resign(id: string): Match {
    const m = this.getMatch(id);
    if (m.finished) throw new ServiceError(400, '这盘已经结束了');
    m.applyResign(m.playerColor);
    m.touch();
    m.settlement = this.settle(m);
    this.emitGame(m);
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
    this.emitGame(m);
    return m;
  }

  // ------------------------------------------------------------ AI

  private async runAi(m: Match): Promise<void> {
    if (m.aiThinking) return;
    m.aiThinking = true;
    this.emitGame(m);
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
      this.emitGame(m);
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
    this.emitGame(m);
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
        handicap: m.game.handicap,
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

  async analyze(
    id: string,
    depth?: 'quick' | 'standard' | 'deep',
    assumeLevel?: number | null,
  ): Promise<
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
      setup:
        m.game.setup.black.length || m.game.setup.white.length
          ? { black: [...m.game.setup.black], white: [...m.game.setup.white] }
          : undefined,
      // 分析一律用主模型；访问量由分析档位单独给（不用等级表里的 visits）
      level: 15,
      assumeLevel: assumeLevel ?? null,
      ...preset,
    });
    if (!result) return { available: false, reason: '引擎这次没给出结果（超时或局面异常），再试一次' };
    return { available: true, result };
  }

  /**
   * 复盘：逐手看"这一手比最佳着法亏了多少目"。
   * 每一手都分析**落子前**的局面（轮到落子方），用候选里最佳与实下着的 scoreLead 差算损失，
   * 这样两边视角一致，不用在相邻局面之间换算出符号错误。
   *
   * 性能：分析是**分块**推进的（每次请求前进 REVIEW_CHUNK 个局面就返回），前端轮询拿进度，
   * 长局不会把一次 HTTP 请求卡到几十秒，也能随时中断。
   * 实测（19 路 200 手，RTX 3050 Ti，KataGo 1.18.2 CUDA）：每局面固定开销约 200ms，
   * 与 visits 几乎无关（20 / 80 / 96 / 120 / 200 都试过，平均耗时差 <5%）——
   * 瓶颈是每次 kata-analyze 的启动与收尾，不是 visits 数。所以不压低 visits：压了只降质量、不提速。
   * nnCache：全程复用同一个 GTP 会话，盘面靠 `play` 逐手推进（`EngineManager.syncPosition`
   * 前缀复用），不 clear_board、不重建 session，NN 缓存自然复用。
   */
  async review(id: string): Promise<
    { available: true; result: ReviewResult } | { available: false; reason: string }
  > {
    const m = this.getMatch(id);
    if (!this.engine.ready) {
      return { available: false, reason: '引擎未就绪：在「设置 → 引擎」完成配置后才能复盘' };
    }
    if (m.game.setup.black.length || m.game.setup.white.length) {
      return { available: false, reason: '带摆子的棋谱暂不支持复盘（引擎还不认摆子局面）' };
    }
    const moves = m.moveList();
    if (moves.length === 0) return { available: false, reason: '这盘还没有着手，没什么可复盘的' };

    // 棋谱变了（落子/悔棋/导入）就丢掉旧作业重算；否则接着上次的进度算
    let job = reviewJobs.get(id);
    if (!job || job.moves.length !== moves.length || job.size !== m.size) {
      job = {
        id,
        size: m.size,
        komi: m.game.komi,
        moves,
        limit: Math.min(moves.length, REVIEW_LIMIT),
        next: 0,
        evals: [],
        startedAt: Date.now(),
        running: true,
        cancelled: false,
      };
      reviewJobs.set(id, job);
      pruneReviewJobs(job.startedAt);
    }

    if (job.running) {
      const end = Math.min(job.limit + 1, job.next + REVIEW_CHUNK);
      for (; job.next < end; job.next++) {
        const k = job.next;
        const turn: Color = k === 0 ? 'B' : moves[k - 1]!.color === 'B' ? 'W' : 'B';
        const res = await this.engine.analyze({
          size: job.size,
          komi: job.komi,
          moves: moves.slice(0, k),
          turn,
          level: 15,
          visits: 120,
          minDurationMs: 80,
          maxDurationMs: 300,
          maxMoves: 1,
          intervalMs: 80,
        });
        const best = res?.candidates[0];
        // cfg: reportAnalysisWinratesAs=BLACK → winrate / scoreLead 都是黑方视角
        job.evals.push({ lead: best ? best.scoreLead : null, wr: best ? best.winrate : null });
      }
      if (job.next > job.limit) job.running = false;
    }

    return { available: true, result: buildReviewResult(job) };
  }

  /** 中断复盘：保留已算出的部分，下一次轮询返回 cancelled=true 的最终快照。 */
  cancelReview(id: string): { cancelled: boolean } {
    const job = reviewJobs.get(id);
    if (!job || !job.running) return { cancelled: false };
    job.cancelled = true;
    job.running = false;
    return { cancelled: true };
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

  // ------------------------------------------------------------ 题库（P4）

  private tsumegoCache: { mtimeMs: number; list: TsumegoProblem[] } | null = null;

  private loadTsumego(): TsumegoProblem[] {
    const file = path.join(this.paths.data, 'tsumego', 'index.json');
    try {
      const stat = fs.statSync(file);
      if (this.tsumegoCache && this.tsumegoCache.mtimeMs === stat.mtimeMs) return this.tsumegoCache.list;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { problems?: TsumegoProblem[] };
      const list = Array.isArray(raw.problems) ? raw.problems : [];
      this.tsumegoCache = { mtimeMs: stat.mtimeMs, list };
      return list;
    } catch {
      return [];
    }
  }

  listTsumego(): { id: string; title: string; level: string; size: number }[] {
    return this.loadTsumego().map((p) => ({ id: p.id, title: p.title, level: p.level, size: p.size }));
  }

  getTsumego(id: string): Omit<TsumegoProblem, 'solutions' | 'capture'> {
    const p = this.loadTsumego().find((x) => x.id === id);
    if (!p) throw new ServiceError(404, '没有这道题');
    return { id: p.id, title: p.title, level: p.level, size: p.size, komi: p.komi, toPlay: p.toPlay, grid: p.grid, hint: p.hint };
  }

  /** 判题：以"提子数达到 capture"为准（比坐标比对宽容，也不怕题目有多种下法） */
  tryTsumego(id: string, vertex: number): { correct: boolean; captured: number; message: string } {
    const p = this.loadTsumego().find((x) => x.id === id);
    if (!p) throw new ServiceError(404, '没有这道题');
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= p.size * p.size) {
      throw new ServiceError(400, '落点不在棋盘上');
    }
    const setup = { black: [] as number[], white: [] as number[] };
    p.grid.forEach((c, i) => {
      if (c === 1) setup.black.push(i);
      if (c === 2) setup.white.push(i);
    });
    const game = new Game({ size: p.size, komi: p.komi, toPlay: p.toPlay, setup });
    const res = game.play(p.toPlay, vertex);
    if (!res.ok) return { correct: false, captured: 0, message: res.message ?? '这一手不能下' };
    const captured = res.captured?.length ?? 0;
    if (captured >= p.capture) {
      return { correct: true, captured, message: captured > 0 ? `正解：提掉 ${captured} 子` : '正解' };
    }
    return { correct: false, captured, message: captured > 0 ? `提了 ${captured} 子，还不够` : '没提到子，再找找白棋的气' };
  }

  // ------------------------------------------------------------ 手谈（联机房间）

  createRoom(opts: {
    size?: BoardSize;
    komi?: number;
    name?: string;
    clientId: string;
    /** 与 /api/game 同结构：null = 不限时，不传 = 10 分 + 3×30 秒 */
    timeControl?: TimeControl | null;
    /** 让子 2~9；1 与非数字都按 0 处理，让 2 子以上贴目自动变 0.5 */
    handicap?: number;
  }): RoomSeat {
    const size: BoardSize = BOARD_SIZES.includes(opts.size ?? 19) ? (opts.size as BoardSize) : 19;
    const komi = Number.isFinite(opts.komi) ? Number(opts.komi) : DEFAULT_KOMI;
    const name = (opts.name ?? '').trim().slice(0, 12) || '房主';
    const timeControl: TimeControl | null =
      opts.timeControl === null ? null : (opts.timeControl ?? DEFAULT_TIME_CONTROL);
    const room = new Room(makeRoomCode(new Set(this.rooms.keys())), size, komi, timeControl, opts.handicap ?? 0);
    this.rooms.set(room.code, room);
    const color = room.seat(opts.clientId, name);
    this.emit('room', room.snapshot());
    return { room: room.snapshot(), color };
  }

  /** 房主在等人阶段改时间制 / 让子（开局后拒绝，见 Room.updateSettings） */
  updateRoomSettings(code: string, clientId: string, patch: RoomSettings): Room {
    const room = this.roomOf(code);
    if (!clientId) throw new ServiceError(400, '缺少客户端标识');
    try {
      room.updateSettings(clientId, patch);
    } catch (err) {
      if (err instanceof RoomError) throw new ServiceError(err.status, err.message);
      throw err;
    }
    this.emit('room', room.snapshot());
    return room;
  }

  joinRoom(code: string, opts: { name?: string; clientId: string }): RoomSeat {
    const room = this.roomOf(code);
    const name = (opts.name ?? '').trim().slice(0, 12) || '棋友';
    const color = room.seat(opts.clientId, name);
    this.emit('room', room.snapshot());
    return { room: room.snapshot(), color };
  }

  getRoom(code: string): Room {
    return this.roomOf(code);
  }

  listRooms(): { code: string; size: number; black: string | null; white: string | null; status: string }[] {
    return [...this.rooms.values()].map((r) => {
      const s = r.snapshot();
      return { code: s.code, size: s.size, black: s.black, white: s.white, status: s.status };
    });
  }

  roomAction(
    code: string,
    clientId: string,
    action: 'move' | 'pass' | 'resign' | 'undo' | 'undo-yes' | 'undo-no' | 'leave',
    payload?: { vertex?: number },
  ): Room {
    const room = this.roomOf(code);
    if (!clientId) throw new ServiceError(400, '缺少客户端标识');
    try {
      switch (action) {
        case 'move':
          room.play(clientId, Number(payload?.vertex));
          break;
        case 'pass':
          room.pass(clientId);
          break;
        case 'resign':
          room.resign(clientId);
          break;
        case 'undo':
          room.requestUndo(clientId);
          break;
        case 'undo-yes':
          room.answerUndo(clientId, true);
          break;
        case 'undo-no':
          room.answerUndo(clientId, false);
          break;
        case 'leave':
          room.leave(clientId);
          if (!room.black && !room.white && room.spectators.size === 0) this.rooms.delete(room.code);
          break;
      }
    } catch (err) {
      if (err instanceof RoomError) throw new ServiceError(err.status, err.message);
      throw err;
    }
    this.emit('room', room.snapshot());
    return room;
  }

  roomChat(code: string, clientId: string, text: string): Room {
    const room = this.roomOf(code);
    room.say(clientId, text);
    this.emit('room', room.snapshot());
    return room;
  }

  private roomOf(code: string): Room {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (!room) throw new ServiceError(404, '没有这个房间（房间码错了，或房主已经退出）');
    return room;
  }

  /** 导出进度：存档 + 等级表，换机器时导入用（当前只导出，不自动导入） */
  exportProgress(): { app: string; schemaVersion: number; exportedAt: string; progress: unknown; ranks: unknown } {
    return {
      app: 'xingyi',
      schemaVersion: this.progress.schemaVersion,
      exportedAt: new Date().toISOString(),
      progress: this.progress,
      ranks: { step: this.ranks.step, stepCi95: this.ranks.stepCi95, levels: this.ranks.levels },
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

interface TsumegoProblem {
  id: string;
  title: string;
  level: string;
  size: BoardSize;
  komi: number;
  toPlay: Color;
  grid: number[];
  solutions: number[];
  capture: number;
  hint: string;
}
