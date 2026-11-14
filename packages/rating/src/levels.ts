import { BEGINNER_LEVEL } from '@xingyi/shared';

export interface LevelCalibration {
  level: number;
  rating: number;
  /** 是否已实测 */
  calibrated: boolean;
  /** 实测样本数（该级参与的相邻对局数） */
  sample?: number;
  /** 由相邻对局反推的该级 ±95% 区间（BT 拟合） */
  ci95?: [number, number] | null;
  /** 没有直接测量，按实测斜率外推 */
  extrapolated?: boolean;
  measuredAt?: string;
}

export interface RankTable {
  ladderVersion: 2;
  maxLevel: number;
  calibrated: boolean;
  levels: LevelCalibration[];
  /** 线性阶梯的实测斜率（分/级） */
  step?: number;
  stepCi95?: [number, number];
  note?: string;
  source?: string[];
}

export const MAX_LEVEL_DEFAULT = BEGINNER_LEVEL;
/** 每级评分间隔（0 分 = 同级 50% 胜率） */
export const RATING_STEP = 75;
export const BASE_RATING = 1525;

export function defaultRankTable(maxLevel = MAX_LEVEL_DEFAULT): RankTable {
  const levels: LevelCalibration[] = [];
  for (let k = 1; k <= maxLevel; k++) {
    levels.push({
      level: k,
      rating: BASE_RATING + (Math.ceil(maxLevel / 2) - k) * RATING_STEP,
      calibrated: false,
    });
  }
  return { ladderVersion: 2, maxLevel, calibrated: false, levels };
}

export function ratingOf(table: RankTable, level: number): number {
  const lv = Number.isFinite(level) ? Math.min(table.maxLevel, Math.max(1, Math.round(level))) : table.maxLevel;
  return table.levels[lv - 1]?.rating ?? BASE_RATING;
}

/** 规范化外部 ranks.json：缺项回退默认值，坏数据不炸程序。 */
export function normalizeRankTable(raw: unknown, maxLevel = MAX_LEVEL_DEFAULT): RankTable {
  const def = defaultRankTable(maxLevel);
  if (!raw || typeof raw !== 'object') return def;
  const src = raw as Partial<RankTable>;
  if (src.ladderVersion !== 2 || src.maxLevel !== maxLevel || !Array.isArray(src.levels) ||
      src.levels.length !== maxLevel) return def;
  const levels = src.levels;
  if (levels.some((row, i) => !row || row.level !== i + 1 || !Number.isFinite(row.rating) ||
      (i > 0 && levels[i - 1]!.rating <= row.rating))) return def;
  return {
    ...src,
    ladderVersion: 2,
    maxLevel,
    levels,
    calibrated: levels.every((row) => row.calibrated === true),
  };
}
