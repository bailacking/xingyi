/**
 * 15 级校准分（A_k）。
 *
 * 这里的值是**没有 ranks.json 时的兜底占位**（8 级 = 1525、每级 75 分）。
 * 真值由 `scripts/calibrate.mjs` 实测、`scripts/fit-ranks.mjs --write` 写进 `data/ranks.json`。
 *
 * 字段语义（AGENTS.md §8）：
 * - `calibrated`：该级有足够样本的实测（样本数 ≥ 30）
 * - `extrapolated`：该级没有直接测（如高段主模型太慢），由实测斜率外推
 * - 表级 `calibrated` = 每一级都 `calibrated` 或 `extrapolated`，且至少一级真测过
 */
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
  maxLevel: number;
  calibrated: boolean;
  levels: LevelCalibration[];
  /** 线性阶梯的实测斜率（分/级） */
  step?: number;
  stepCi95?: [number, number];
  note?: string;
  source?: string[];
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
        ci95: Array.isArray(hit.ci95) ? hit.ci95 : null,
        extrapolated: Boolean(hit.extrapolated),
        measuredAt: hit.measuredAt,
      };
    }),
  };
  out.step = typeof src.step === 'number' ? src.step : undefined;
  out.stepCi95 = Array.isArray(src.stepCi95) ? src.stepCi95 : undefined;
  out.note = typeof src.note === 'string' ? src.note : undefined;
  out.source = Array.isArray(src.source) ? src.source : undefined;
  // 外推级不算"已实测"，但也不该让整表被当成占位值——所以两个都接受
  out.calibrated = out.levels.every((l) => l.calibrated || l.extrapolated) && out.levels.some((l) => l.calibrated);
  return out;
}
