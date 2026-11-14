import { BEGINNER_LEVEL, PLACEMENT_GAMES, PROGRESS_SCHEMA_VERSION, STRONGEST_LEVEL, type Mode } from '@xingyi/shared';
import { RATING_PARAMS, updateRating, type RatingUpdate } from './glicko.js';
import { defaultRankTable, ratingOf, type RankTable } from './levels.js';

/** 定级赛：最多五盘自适应二分（AGENTS.md §8）。 */
export interface PlacementState {
  /** 已下盘数 0..5 */
  stage: number;
  /** 可能达到的最强级 */
  lo: number;
  /** 已确认的最弱边界 */
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
  legacyLevels?: { opponent: number; after: number };
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
  gamesWon: number;
  gamesLost: number;
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
  legacyPlacement?: PlacementState;
}

export function createProgress(playerName = '无名', maxLevel = BEGINNER_LEVEL, now = new Date()): Progress {
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
    gamesWon: 0,
    gamesLost: 0,
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

/** 记一盘定级结果，在剩余的级数区间内二分。 */
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
  if (won) pl.hi = pl.current;
  else pl.lo = Math.min(pl.hi, pl.current + 1);

  p.gamesTotal += 1;
  if (won) p.gamesWon += 1;
  else p.gamesLost += 1;
  p.streak = won ? Math.max(1, p.streak + 1) : Math.min(-1, p.streak - 1);
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.updatedAt = now.toISOString();
  pl.done = pl.lo === pl.hi || pl.stage >= PLACEMENT_GAMES;
  pl.current = pl.done ? pl.hi : Math.floor((pl.lo + pl.hi) / 2);
  p.level = pl.current;
  p.R = ratingOf(ranks, p.level);
  if (pl.done) {
    p.RD = 220;
    p.levelGames = 0;
    p.levelWins = 0;
    p.provisional = p.gamesTotal < RATING_PARAMS.provisionalGames;
  }
  return { done: pl.done, level: pl.current };
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
  exam?: boolean;
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

/** 升级/降级/跳档判定（AGENTS.md §8 的升降级阈值）。 */
export function evaluateLevel(p: Progress, ranks: RankTable): {
  promote: boolean;
  demote: boolean;
  pending: boolean;
  reason: string;
} {
  const notes: string[] = [];
  const atStrongest = p.level === STRONGEST_LEVEL;
  const atBeginner = p.level === ranks.maxLevel;
  const winRate = p.levelGames > 0 ? p.levelWins / p.levelGames : 0;

  const nextRating = atStrongest ? Infinity : ratingOf(ranks, p.level - 1);
  const prevRating = atBeginner ? -Infinity : ratingOf(ranks, p.level + 1);

  // 阶梯不要求等距（实测每级 50~190 分），阈值按**本级局部步长**换算，
  // 否则窄档位一局就升、宽档位怎么打都不升。
  const curRating = ratingOf(ranks, p.level);
  const stepUp = atStrongest ? 0 : Math.max(1, nextRating - curRating);
  const stepDown = atBeginner ? 0 : Math.max(1, curRating - prevRating);
  const thrUp = Math.min(120, Math.max(20, Math.round(stepUp * 0.35)));
  const thrDown = Math.min(150, Math.max(30, Math.round(stepDown * 0.5)));
  const promoteLine = nextRating - thrUp;
  const demoteLine = prevRating - thrDown;

  const promote =
    !atStrongest &&
    p.R >= promoteLine &&
    p.levelGames >= 3 &&
    (p.streak >= 2 || winRate >= 0.6);

  const demote =
    !atBeginner &&
    p.protection <= 0 &&
    p.demotionBuffer <= 0 &&
    p.R < demoteLine &&
    p.streak <= -2;

  // 「可进一级」：连胜 ≥3 且已够分（考核局由玩家点出来）
  const pending = !atStrongest && p.streak >= 3 && p.R >= promoteLine && p.promotionCooldown <= 0;

  if (promote) notes.push(`R=${p.R} ≥ ${promoteLine}（本级步长 ${stepUp} 分），满足升级条件`);
  if (demote) notes.push(`R=${p.R} < ${demoteLine}（本级步长 ${stepDown} 分）且连败，触发降级`);
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
  if (input.won) p.gamesWon += 1;
  else p.gamesLost += 1;
  if (!input.exam) {
    p.levelGames += 1;
    if (input.won) p.levelWins += 1;
  }
  p.streak = input.won ? Math.max(1, p.streak + 1) : Math.min(-1, p.streak - 1);
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.protection = Math.max(0, p.protection - 1);
  p.demotionBuffer = Math.max(0, p.demotionBuffer - 1);
  p.promotionCooldown = Math.max(0, p.promotionCooldown - 1);
  p.provisional = p.gamesTotal < RATING_PARAMS.provisionalGames;

  let change: 'up' | 'down' | null = null;
  const verdict = evaluateLevel(p, ranks);
  if (input.exam) {
    p.pendingPromotion = false;
  } else if (verdict.promote) {
    p.level -= 1;
    p.levelGames = 0;
    p.levelWins = 0;
    p.protection = 3;
    p.pendingPromotion = false;
    change = 'up';
    notes.push(`升为 ${p.level} 级`);
  } else if (verdict.demote) {
    p.level += 1;
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
  const target = Math.max(STRONGEST_LEVEL, p.level - 2, Math.min(p.level - 1, targetLevel));
  const out = applyRankedGame(p, {
    won,
    scoreDiff: input.scoreDiff,
    moves: input.moves,
    ranks,
    opponentLevel: target,
    now,
    mode: 'ranked',
    text: input.text,
    exam: true,
  });
  if (won && target < p.level) {
    p.level = target;
    p.levelGames = 0;
    p.levelWins = 0;
    p.protection = 3;
    p.pendingPromotion = false;
    out.change = 'up';
    out.toLevel = p.level;
    const entry = p.history.at(-1);
    if (entry) entry.levelAfter = target;
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

// v1 的对手参数尽可能映射到同一难度，旧的编号与定级结果随存档保留。
const legacyLevels = [25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 1];
const legacyLevel = (value: number): number => legacyLevels[Math.min(15, Math.max(1, Math.round(value || 1))) - 1]!;

export function normalizeProgress(raw: unknown, maxLevel = BEGINNER_LEVEL, ranks = defaultRankTable(maxLevel)): Progress {
  const base = createProgress('无名', maxLevel);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const src = raw as Partial<Progress>;
  const p = { ...base, ...src, schemaVersion: PROGRESS_SCHEMA_VERSION };
  p.placement = { ...base.placement, ...src.placement };
  p.history = Array.isArray(src.history) ? src.history.filter((row) => row && typeof row === 'object').slice(-500) : [];
  if (!Number.isInteger(src.gamesWon) || !Number.isInteger(src.gamesLost)) {
    const results = [...(src.legacyPlacement?.results ?? []), ...(p.placement.results ?? []), ...p.history];
    p.gamesWon = results.filter((row) => row?.won === true).length;
    p.gamesLost = results.filter((row) => row?.won === false).length;
  }
  if (src.schemaVersion !== PROGRESS_SCHEMA_VERSION) {
    if (src.placement) p.legacyPlacement = p.placement;
    p.history = p.history.map((row) => ({
      ...row,
      legacyLevels: { opponent: row.level, after: row.levelAfter },
      level: legacyLevel(row.level),
      levelAfter: legacyLevel(row.levelAfter),
    }));
    if (p.placement.done) {
      const oldLevel = Math.min(15, Math.max(1, Math.round(Number(src.level) || 1)));
      p.level = legacyLevel(oldLevel);
      const oldAnchor = 1525 + (oldLevel - 8) * 90;
      const offset = Number.isFinite(src.R) ? Math.max(-75, Math.min(75, src.R! - oldAnchor)) : 0;
      p.R = ratingOf(ranks, p.level) + offset;
      p.placement = { ...base.placement, done: true, current: p.level, lo: p.level, hi: p.level };
      p.RD = Math.max(160, Number(p.RD) || 0);
    } else {
      p.level = base.level;
      p.R = base.R;
      p.RD = base.RD;
      p.placement = base.placement;
      p.provisional = true;
    }
    p.levelGames = 0;
    p.levelWins = 0;
    p.streak = 0;
    p.pendingPromotion = false;
  }
  p.level = Math.min(maxLevel, Math.max(1, Math.round(Number(p.level) || base.level)));
  if (!Number.isFinite(p.R)) p.R = ratingOf(ranks, p.level);
  if (!Number.isFinite(p.RD)) p.RD = RATING_PARAMS.initialRD;
  return p;
}
