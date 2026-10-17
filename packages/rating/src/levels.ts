/**
 * 15 级校准分（A_k）。
 *
 * ⚠️ 这张表是**占位默认值，尚未实测**（PLAN §8 / R5）：
 * 正式数值要靠「该级 AI vs 主模型限时」对局跑出来，写进 `data/ranks.json`。
 * 在 `calibrated: false` 之前，界面必须显示「等级校准分未实测」。
 *
 * 取值依据（B 类，有公式但需实测校正）：R=1500 对应 8 级（定级赛首局对手），
 * 每级间隔 75 分——75 分约等于 70% 胜率，符合"一级一个台阶"的直觉。
 */
export interface LevelCalibration {
  level: number;
  rating: number;
  /** 是否已实测 */
  calibrated: boolean;
  /** 实测样本数 */
  sample?: number;
  measuredAt?: string;
}

export interface RankTable {
  maxLevel: number;
  calibrated: boolean;
  levels: LevelCalibration[];
}

export const MAX_LEVEL_DEFAULT = 15;
/** 每级评分间隔（0 分 = 同级 50% 胜率） */
export const RATING_STEP = 75;
export const BASE_RATING = 1525;

export function defaultRankTable(maxLevel = MAX_LEVEL_DEFAULT): RankTable {
  const levels: LevelCalibration[] = [];
  for (let k = 1; k <= maxLevel; k++) {
    levels.push({
      level: k,
      rating: BASE_RATING + (k - 8) * RATING_STEP,
      calibrated: false,
    });
  }
  return { maxLevel, calibrated: false, levels };
}

export function ratingOf(table: RankTable, level: number): number {
  const lv = Math.min(table.maxLevel, Math.max(1, Math.round(level)));
  return table.levels[lv - 1]?.rating ?? BASE_RATING;
}

/** 规范化外部 ranks.json：缺项回退默认值，坏数据不炸程序。 */
export function normalizeRankTable(raw: unknown, maxLevel = MAX_LEVEL_DEFAULT): RankTable {
  const def = defaultRankTable(maxLevel);
  if (!raw || typeof raw !== 'object') return def;
  const src = raw as Partial<RankTable>;
  if (!Array.isArray(src.levels)) return def;
  const out: RankTable = {
    maxLevel: typeof src.maxLevel === 'number' ? src.maxLevel : maxLevel,
    calibrated: Boolean(src.calibrated),
    levels: def.levels.map((fallback) => {
      const hit = src.levels!.find((l) => l && l.level === fallback.level);
      if (!hit) return fallback;
      return {
        level: fallback.level,
        rating: typeof hit.rating === 'number' ? hit.rating : fallback.rating,
        calibrated: Boolean(hit.calibrated),
        sample: hit.sample,
        measuredAt: hit.measuredAt,
      };
    }),
  };
  out.calibrated = out.levels.every((l) => l.calibrated);
  return out;
}
