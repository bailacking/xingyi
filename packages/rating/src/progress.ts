import { PROGRESS_SCHEMA_VERSION, type Mode } from '@xingyi/shared';
import { RATING_PARAMS, updateRating, type RatingUpdate } from './glicko.js';
import { ratingOf, type RankTable } from './levels.js';

/** 定级赛：3 盘自适应二分（PLAN §3.3）。 */
export interface PlacementState {
  /** 已下盘数 0..3 */
  stage: number;
  /** 已确定的下界（赢过的最高级） */
  lo: number;
  /** 已确定的上界（输过的最低级） */
  hi: number;
  /** 下一局（或本局）的对手级 */
  current: number;
  results: { level: number; won: boolean }[];
  done: boolean;
}

export interface GameRecord {
  at: string;
  mode: Mode;
  /** 对手级 */
  level: number;
  won: boolean;
  /** 数子目差（正=自己赢） */
  scoreDiff: number;
  moves: number;
  deltaR: number;
  levelAfter: number;
  text?: string;
}

export interface Progress {
  schemaVersion: number;
  playerName: string;
  createdAt: string;
  updatedAt: string;
  /** 当前级 1..maxLevel */
  level: number;
  R: number;
  RD: number;
  /** 前 10 盘为暂定级 */
  provisional: boolean;
  gamesTotal: number;
  /** 本级已下盘数（升级判定用） */
  levelGames: number;
  levelWins: number;
  /** 正=连胜，负=连败 */
  streak: number;
  bestStreak: number;
  /** 保级期剩余盘数（升入新级后 3 盘内不降级） */
  protection: number;
  /** 退级缓冲剩余盘数（降级后 5 盘内不连降） */
  demotionBuffer: number;
  /** 跳档考核冷却盘数 */
  promotionCooldown: number;
  /** 结算页底部「可进一级」 */
  pendingPromotion: boolean;
  placement: PlacementState;
  history: GameRecord[];
}

export function createProgress(playerName = '无名', maxLevel = 15, now = new Date()): Progress {
  const first = Math.ceil((1 + maxLevel) / 2);
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    playerName,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    level: first,
    R: RATING_PARAMS.initialR,
    RD: RATING_PARAMS.initialRD,
    provisional: true,
    gamesTotal: 0,
    levelGames: 0,
    levelWins: 0,
    streak: 0,
    bestStreak: 0,
    protection: 0,
    demotionBuffer: 0,
    promotionCooldown: 0,
    pendingPromotion: false,
    placement: { stage: 0, lo: 1, hi: maxLevel, current: first, results: [], done: false },
    history: [],
  };
}

/** 定级赛下一局的对手级：赢取上整、输取下整（PLAN §3.3 的表）。 */
export function placementNextLevel(state: PlacementState, maxLevel: number): number {
  const mid = (state.lo + state.hi) / 2;
  let next = Math.round(mid);
  if (next === state.current) next = state.current + 1 <= maxLevel ? state.current + 1 : state.current - 1;
  return Math.min(maxLevel, Math.max(1, next));
}

/**
 * 记一盘定级赛。第 3 盘后定级：取"赢过的最高级"，全负则 1 级。
 * 返回定级结果（未完成返回 null）。
 */
export function recordPlacementResult(
  p: Progress,
  ranks: RankTable,
  won: boolean,
  now = new Date(),
): { done: boolean; level: number } | null {
  const pl = p.placement;
  if (pl.done) return null;
  pl.results.push({ level: pl.current, won });
  pl.stage += 1;
  if (won) pl.lo = Math.max(pl.lo, pl.current);
  else pl.hi = Math.min(pl.hi, pl.current);

  p.gamesTotal += 1;
  p.streak = won ? Math.max(1, p.streak + 1) : Math.min(-1, p.streak - 1);
  p.bestStreak = Math.max(p.bestStreak, p.streak);

  if (pl.stage >= 3) {
    pl.done = true;
    const level = Math.min(ranks.maxLevel, Math.max(1, pl.lo));
    p.level = level;
    p.R = ratingOf(ranks, level);
    p.RD = 220;
    p.levelGames = 0;
    p.levelWins = 0;
    p.provisional = p.gamesTotal < RATING_PARAMS.provisionalGames;
    p.updatedAt = now.toISOString();
    return { done: true, level };
  }

  pl.current = won
    ? Math.min(pl.hi, Math.max(pl.current + 1, Math.ceil((pl.lo + pl.hi) / 2)))
    : Math.max(pl.lo, Math.min(pl.current - 1, Math.floor((pl.lo + pl.hi) / 2)));
  p.updatedAt = now.toISOString();
  return { done: false, level: pl.current };
}

export interface RankedGameInput {
  won: boolean;
  scoreDiff: number;
  moves: number;
  ranks: RankTable;
  /** 被对手让子/让目时用，一般等于 p.level */
  opponentLevel?: number;
  now?: Date;
  mode?: Mode;
  text?: string;
}

export interface RankedOutcome {
  rating: RatingUpdate;
  /** 级数变化：'up' 升 1 级 / 'down' 降 1 级 / null 不变 */
  change: 'up' | 'down' | null;
  fromLevel: number;
  toLevel: number;
  /** 结算页底部那行小字是否出现 */
  pendingPromotion: boolean;
  /** 给日志看的一句话解释 */
  notes: string[];
}

/** 升级/降级/跳档判定（PLAN §3.4）。 */
export function evaluateLevel(p: Progress, ranks: RankTable): {
  promote: boolean;
  demote: boolean;
  pending: boolean;
  reason: string;
} {
  const max = ranks.maxLevel;
  const notes: string[] = [];
  const atMax = p.level >= max;
  const winRate = p.levelGames > 0 ? p.levelWins / p.levelGames : 0;

  const nextRating = atMax ? Infinity : ratingOf(ranks, p.level + 1);
  const prevRating = p.level <= 1 ? -Infinity : ratingOf(ranks, p.level - 1);

  const promote =
    !atMax &&
    p.R >= nextRating - 50 &&
    p.levelGames >= 3 &&
    (p.streak >= 2 || winRate >= 0.6);

  const demote =
    p.level > 1 &&
    p.protection <= 0 &&
    p.demotionBuffer <= 0 &&
    p.R < prevRating - 100 &&
    p.streak <= -2;

  // 「可进一级」：连胜 ≥3 且已够分（考核局由玩家点出来）
  const pending = !atMax && p.streak >= 3 && p.R >= nextRating - 50 && p.promotionCooldown <= 0;

  if (promote) notes.push(`R=${p.R} ≥ ${nextRating - 50}，满足升级条件`);
  if (demote) notes.push(`R=${p.R} < ${prevRating - 100} 且连败，触发降级`);
  if (pending) notes.push('连胜 ≥3，可发起跳档考核');
  return { promote, demote, pending, reason: notes.join('；') };
}

export function applyRankedGame(p: Progress, input: RankedGameInput): RankedOutcome {
  const now = input.now ?? new Date();
  const ranks = input.ranks;
  const opponentLevel = input.opponentLevel ?? p.level;
  const opponentRating = ratingOf(ranks, opponentLevel);
  const fromLevel = p.level;
  const notes: string[] = [];

  const rating = updateRating({
    R: p.R,
    RD: p.RD,
    opponentRating,
    won: input.won,
    scoreDiff: input.scoreDiff,
    gamesAtLevel: p.levelGames,
    moves: input.moves,
    provisional: p.provisional,
  });
  p.R = rating.R;
  p.RD = rating.RD;
  p.gamesTotal += 1;
  p.levelGames += 1;
  if (input.won) p.levelWins += 1;
  p.streak = input.won ? Math.max(1, p.streak + 1) : Math.min(-1, p.streak - 1);
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.protection = Math.max(0, p.protection - 1);
  p.demotionBuffer = Math.max(0, p.demotionBuffer - 1);
  p.promotionCooldown = Math.max(0, p.promotionCooldown - 1);
  p.provisional = p.gamesTotal < RATING_PARAMS.provisionalGames;

  let change: 'up' | 'down' | null = null;
  const verdict = evaluateLevel(p, ranks);
  if (verdict.promote) {
    p.level = Math.min(ranks.maxLevel, p.level + 1);
    p.levelGames = 0;
    p.levelWins = 0;
    p.protection = 3;
    p.pendingPromotion = false;
    change = 'up';
    notes.push(`升为 ${p.level} 级`);
  } else if (verdict.demote) {
    p.level = Math.max(1, p.level - 1);
    p.levelGames = 0;
    p.levelWins = 0;
    p.demotionBuffer = 5;
    p.pendingPromotion = false;
    change = 'down';
    notes.push(`降为 ${p.level} 级`);
  } else {
    p.pendingPromotion = verdict.pending;
    if (verdict.reason) notes.push(verdict.reason);
  }

  p.updatedAt = now.toISOString();
  p.history.push({
    at: now.toISOString(),
    mode: input.mode ?? 'ranked',
    level: opponentLevel,
    won: input.won,
    scoreDiff: input.scoreDiff,
    moves: input.moves,
    deltaR: rating.deltaR,
    levelAfter: p.level,
    text: input.text,
  });
  if (p.history.length > 500) p.history = p.history.slice(-500);

  return {
    rating,
    change,
    fromLevel,
    toLevel: p.level,
    pendingPromotion: p.pendingPromotion,
    notes,
  };
}

/** 跳档考核：对高 1~2 级下一盘，赢则直接跳过去；输不降级但冷却 3 盘。 */
export function applyJumpExam(
  p: Progress,
  ranks: RankTable,
  targetLevel: number,
  won: boolean,
  input: { scoreDiff: number; moves: number; now?: Date; text?: string },
): RankedOutcome {
  const now = input.now ?? new Date();
  const target = Math.min(ranks.maxLevel, Math.max(p.level + 1, targetLevel));
  const out = applyRankedGame(p, {
    won,
    scoreDiff: input.scoreDiff,
    moves: input.moves,
    ranks,
    opponentLevel: target,
    now,
    mode: 'ranked',
    text: input.text,
  });
  if (won && target > p.level) {
    p.level = target;
    p.levelGames = 0;
    p.levelWins = 0;
    p.protection = 3;
    p.pendingPromotion = false;
    out.change = 'up';
    out.toLevel = p.level;
    out.notes.push(`考核通过，跳至 ${target} 级`);
  } else if (!won) {
    p.promotionCooldown = 3;
    p.pendingPromotion = false;
    out.pendingPromotion = false;
    out.notes.push('考核未过，3 盘后可再考');
  }
  p.updatedAt = now.toISOString();
  return out;
}

/** 兼容旧存档：补齐缺失字段，避免改结构后读档就炸。 */
export function normalizeProgress(raw: unknown, maxLevel = 15): Progress {
  const base = createProgress();
  if (!raw || typeof raw !== 'object') return base;
  const p = { ...base, ...(raw as Partial<Progress>) } as Progress;
  p.schemaVersion = PROGRESS_SCHEMA_VERSION;
  p.placement = { ...base.placement, ...((raw as Partial<Progress>).placement ?? {}) };
  p.history = Array.isArray(p.history) ? p.history.slice(-500) : [];
  p.level = Math.min(maxLevel, Math.max(1, Number(p.level) || 1));
  if (!Number.isFinite(p.R)) p.R = RATING_PARAMS.initialR;
  if (!Number.isFinite(p.RD)) p.RD = RATING_PARAMS.initialRD;
  return p;
}
