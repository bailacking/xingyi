#!/usr/bin/env node
/**
 * 从校准日志拟合 A_k（等级评分表）。
 *
 *   node scripts/fit-ranks.mjs data/calibration/xxx.jsonl
 *
 * 做的事：
 * 1. 每个相邻对：p = 低级胜率（拉普拉斯平滑）→ Δ = 400·log10(p/(1−p))
 * 2. 以 8 级 = 1525 为锚，向两侧累加得到原始分数
 * 3. **保序回归（PAVA）**强制单调：等级越高分数一定越高。
 *    样本小的时候会出现"7 级反杀 8 级"这种噪声，直接信它会让升降级逻辑崩掉，
 *    所以用保序回归把违反单调的相邻块合并（这是统计上的标准做法，不是拍脑袋）。
 * 4. 未测到的级（13~15）用已测段的平均步长外推，并标 calibrated:false
 *
 * 为什么标 calibrated:false：8 盘/组的 95% 置信区间大约 ±3 级，
 * 只能说明"大致单调"，定不死 75 分一档。要定死至少每组 40~100 盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/fit-ranks.mjs <calibration.jsonl>');
  process.exit(1);
}

const ANCHOR_LEVEL = 8;
const ANCHOR_RATING = 1525;
const MIN_SAMPLE = 30; // 少于这个样本量不认"已校准"

const rows = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const byPair = new Map();
for (const r of rows) {
  const key = r.pair.join('-');
  const cur = byPair.get(key) ?? { lo: r.pair[0], hi: r.pair[1], wins: 0, games: 0 };
  cur.games += 1;
  if (r.loWon) cur.wins += 1;
  byPair.set(key, cur);
}

const pairs = [...byPair.values()].sort((a, b) => a.lo - b.lo);
for (const p of pairs) {
  const rate = (p.wins + 0.5) / (p.games + 1);
  p.delta = 400 * Math.log10(rate / (1 - rate)); // = R_lo − R_hi
  console.log(
    `  ${p.lo} vs ${p.hi}：${p.wins}/${p.games}（${(rate * 100).toFixed(0)}%）→ 高一级强 ${(-p.delta).toFixed(0)} 分`,
  );
}

const byLo = new Map(pairs.map((p) => [p.lo, p]));
const raw = new Map([[ANCHOR_LEVEL, ANCHOR_RATING]]);
for (let k = ANCHOR_LEVEL; k < 15; k++) {
  const p = byLo.get(k);
  if (!p) break;
  raw.set(k + 1, raw.get(k) - p.delta);
}
for (let k = ANCHOR_LEVEL; k > 1; k--) {
  const p = byLo.get(k - 1);
  if (!p) break;
  raw.set(k - 1, raw.get(k) + p.delta);
}

// PAVA：非降拟合（等级越高分越高）
const points = [...raw.entries()].sort((a, b) => a[0] - b[0]);
const blocks = points.map(([level, value]) => ({
  levels: [level],
  sum: value,
  weight: 1,
}));
const merged = [];
for (const b of blocks) {
  merged.push({ ...b });
  while (merged.length > 1) {
    const last = merged[merged.length - 1];
    const prev = merged[merged.length - 2];
    if (prev.sum / prev.weight <= last.sum / last.weight) break;
    merged.pop();
    prev.levels.push(...last.levels);
    prev.sum += last.sum;
    prev.weight += last.weight;
  }
}
const fitted = new Map();
for (const b of merged) {
  const v = Math.round(b.sum / b.weight);
  for (const level of b.levels) fitted.set(level, v);
}

const measuredMax = Math.max(...fitted.keys());
const measured = [...fitted.entries()].sort((a, b) => a[0] - b[0]);
const step =
  measured.length > 1 ? Math.round((measured[measured.length - 1][1] - measured[0][1]) / (measured.length - 1)) : 100;

const levels = [];
for (let k = 1; k <= 15; k++) {
  const sample = (byLo.get(k)?.games ?? 0) + (byLo.get(k - 1)?.games ?? 0);
  if (fitted.has(k)) {
    levels.push({
      level: k,
      rating: fitted.get(k),
      calibrated: sample >= MIN_SAMPLE,
      sample,
      note: sample >= MIN_SAMPLE ? undefined : '样本不足，仅作参考',
    });
  } else {
    // 13~15：按已测段平均步长外推
    const base = fitted.get(measuredMax);
    levels.push({
      level: k,
      rating: base + step * (k - measuredMax),
      calibrated: false,
      sample: 0,
      note: '未实测，按已测段平均步长外推',
    });
  }
}

const table = {
  maxLevel: 15,
  calibrated: levels.every((l) => l.calibrated),
  calibratedAt: new Date().toISOString().slice(0, 19),
  source: path.basename(file),
  anchor: { level: ANCHOR_LEVEL, rating: ANCHOR_RATING },
  method: '相邻级对局胜率 → Elo 差 → 保序回归（非降）',
  note:
    levels.every((l) => l.calibrated)
      ? '全部等级样本充足'
      : '样本不足，A_k 只保证单调与大致间距；要定死每级 75 分需每组 40~100 盘',
  levels,
};

fs.writeFileSync(path.join(ROOT, 'data/ranks.json'), JSON.stringify(table, null, 2) + '\n');
console.log('\n等级表：');
for (const l of levels) console.log(`  ${String(l.level).padStart(2)} 级：${l.rating}${l.calibrated ? '' : ' *'}`);
console.log('\n已写入 data/ranks.json');
