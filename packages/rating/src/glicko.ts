/**
 * Glicko 式连续评分（AGENTS.md §8）。
 *
 * 这是**简化实现，不是标准 Glicko-2**：
 * - 评级步长按本项目的 K_eff 公式算，不用 Glicko 原始 q·g/(1/RD²+1/d²)（那个对新号过于剧烈）
 * - 不确定度 RD 用 Glicko-1 的 d² 公式更新，只用来决定 K 的大小与"暂定级"退出
 * 参数一律不硬编码，集中在 RATING_PARAMS 里，方便用真实数据调。
 */

export interface RatingParams {
  /** 初始分 */
  initialR: number;
  /** 初始不确定度 */
  initialRD: number;
  /** RD 下限（再准也不会低于这个） */
  minRD: number;
  /** K 基数：K = baseK + RD / rdScale */
  baseK: number;
  rdScale: number;
  /** 暂定级 K 放大倍数 */
  provisionalK: number;
  /** 同级刷分局（超过 repeatThreshold 盘）K 折扣 */
  repeatPenaltyK: number;
  repeatThreshold: number;
  /** 目差修正幅度：K_eff = K × (kMin + kSpan × min(|diff|/20, 1)) */
  diffKMin: number;
  diffKSpan: number;
  /** 少于这么多手算速胜，按半分计 */
  fastWinMoves: number;
  /** 前这么多盘算暂定级 */
  provisionalGames: number;
}

export const RATING_PARAMS: RatingParams = {
  initialR: 1500,
  initialRD: 350,
  minRD: 45,
  baseK: 24,
  rdScale: 12,
  provisionalK: 2,
  repeatPenaltyK: 0.5,
  repeatThreshold: 8,
  diffKMin: 0.8,
  diffKSpan: 0.4,
  fastWinMoves: 40,
  provisionalGames: 10,
};

/** 期望胜率 E = 1 / (1 + 10^((A − R)/400)) */
export function expectedScore(playerR: number, opponentR: number): number {
  return 1 / (1 + Math.pow(10, (opponentR - playerR) / 400));
}

/** K 随不确定度变化：新号 K 大 → 连赢几盘分飙得远（"高手自动跳档"的自然结果）。 */
export function kFactor(rd: number, p: RatingParams = RATING_PARAMS): number {
  return p.baseK + rd / p.rdScale;
}

/** RD 更新（Glicko-1 的 d²，对手按低不确定度处理）。 */
export function shrinkRD(rd: number, expected: number, p: RatingParams = RATING_PARAMS): number {
  const q = Math.LN10 / 400;
  const e = Math.min(0.95, Math.max(0.05, expected));
  const d2 = 1 / (q * q * e * (1 - e));
  const next = Math.sqrt(1 / (1 / (rd * rd) + 1 / d2));
  return Math.max(p.minRD, Math.min(p.initialRD, next));
}

export interface RatingUpdateInput {
  R: number;
  RD: number;
  opponentRating: number;
  won: boolean;
  /** 目差（数子结果，正=自己赢；认输可传 0） */
  scoreDiff: number;
  /** 已在本级下过的盘数（防刷） */
  gamesAtLevel: number;
  /** 总手数（速胜判定） */
  moves: number;
  provisional: boolean;
  params?: RatingParams;
}

export interface RatingUpdate {
  R: number;
  RD: number;
  deltaR: number;
  expected: number;
  /** 实际计入的结果（0 / 0.5 / 1） */
  s: number;
  kUsed: number;
  /** 触发了哪些修正，便于界面/日志解释 */
  flags: string[];
}

export function updateRating(input: RatingUpdateInput): RatingUpdate {
  const p = input.params ?? RATING_PARAMS;
  const E = expectedScore(input.R, input.opponentRating);
  const flags: string[] = [];

  let s = input.won ? 1 : 0;
  if (input.won && input.moves > 0 && input.moves < p.fastWinMoves) {
    s = 0.5;
    flags.push('speed-win');
  }

  let K = kFactor(input.RD, p);
  if (input.provisional) {
    K *= p.provisionalK;
    flags.push('provisional');
  }
  if (input.gamesAtLevel > p.repeatThreshold) {
    K *= p.repeatPenaltyK;
    flags.push('repeat');
  }

  const diffRatio = Math.min(Math.abs(input.scoreDiff) / 20, 1);
  const KEff = K * (p.diffKMin + p.diffKSpan * diffRatio);
  const deltaR = KEff * (s - E);

  const R = Math.round((input.R + deltaR) * 10) / 10;
  const RD = Math.round(shrinkRD(input.RD, E, p) * 10) / 10;
  return {
    R,
    RD,
    deltaR: Math.round(deltaR * 10) / 10,
    expected: Math.round(E * 1000) / 1000,
    s,
    kUsed: Math.round(KEff * 10) / 10,
    flags,
  };
}
