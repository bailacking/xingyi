#!/usr/bin/env node
/**
 * 从校准日志拟合等级表（v2）
 *
 *   node scripts/fit-ranks.mjs data/calibration/xxx.jsonl            # 只看报告
 *   node scripts/fit-ranks.mjs data/calibration/xxx.jsonl --write    # 写 data/ranks.json
 *   node scripts/fit-ranks.mjs a.jsonl b.jsonl --write               # 同阶梯的多份日志合并
 *
 * 做四件事：
 *  1. 每组单独统计胜率 + Wilson 95% 区间 + Δ 及其区间（诊断用）
 *  2. **Bradley-Terry MLE**（锚点固定）逐级估分，带 Hessian 协方差 → 每级 ±CI
 *  3. **单参数线性阶梯** A_k = anchor + step·(k−anchor)，用似然比给 step 的 95% 区间
 *     —— 15 档、每组几十盘的数据量，只够定"斜率"，定不了每级独立的非线性形状
 *  4. 写 ranks.json：已测级用线性值 + 样本数；未测级标 extrapolated，不吃"已实测"的名义
 *
 * 安全阀：日志的 meta.ladderHash 必须等于应用当前等级表的哈希，
 * 否则拒绝 --write（防止"测的是 A 梯子、写进 B 梯子"）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LEVEL_PARAMS } from '../packages/engine/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
// 跳过 "--opt value" 里的 value，别把它当成文件
const VALUE_OPTS = new Set(['model', 'anchor-level', 'anchor-rating', 'min-sample']);
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (!a.includes('=') && VALUE_OPTS.has(a.slice(2))) i += 1;
    continue;
  }
  files.push(a);
}
const has = (f) => argv.includes(`--${f}`);
const val = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const ANCHOR_LEVEL = Number(val('anchor-level', 8));
const ANCHOR_RATING = Number(val('anchor-rating', 1525));
const MIN_SAMPLE = Number(val('min-sample', 30));
const RATING_FALLBACK = 100;
const MAX_LEVEL = 15;
const C = 400 / Math.log(10);

if (files.length === 0) {
  console.error('用法：node scripts/fit-ranks.mjs <jsonl...> [--write] [--min-sample 30]');
  process.exit(1);
}

/* ---------------- 读日志 ---------------- */

const rows = [];
const metas = [];
const sources = [];
for (const f of files) {
  const p = path.resolve(ROOT, f);
  sources.push(path.relative(ROOT, p));
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const r = JSON.parse(line);
    if (r.type === 'meta') metas.push(r);
    else rows.push(r);
  }
}

const ladderHash = metas[0]?.ladderHash ?? null;
for (const m of metas) {
  if (m.ladderHash !== ladderHash) {
    console.error('拒绝：多份日志的阶梯哈希不一致，不能合并');
    process.exit(2);
  }
}

const appLadderHash = crypto
  .createHash('sha1')
  .update(
    JSON.stringify(
      LEVEL_PARAMS.map((p) => [p.level, p.profile, p.maxVisits, p.lambda ?? (p.profile ? 1e8 : 0), p.rootExplore ?? 0, null]),
    ),
  )
  .digest('hex')
  .slice(0, 12);

if (has('write') && ladderHash && ladderHash !== appLadderHash && !has('force')) {
  console.error(
    `拒绝写入：日志阶梯 ${ladderHash} ≠ 应用阶梯 ${appLadderHash}。\n` +
      `先把实验阶梯的参数落进 packages/engine/src/params.ts，或加 --force。`,
  );
  process.exit(3);
}

/* ---------------- 基础统计 ---------------- */

const byPair = new Map();
for (const r of rows) {
  const key = `${r.pair[0]}-${r.pair[1]}`;
  const item = byPair.get(key) ?? { lo: r.pair[0], hi: r.pair[1], w: 0, n: 0, capped: 0, plies: 0 };
  item.n += 1;
  item.w += r.loWon ? 1 : 0;
  item.capped += r.capped ? 1 : 0;
  item.plies += r.plies ?? 0;
  byPair.set(key, item);
}
const pairs = [...byPair.values()].sort((a, b) => a.lo - b.lo);

function wilson(w, n, z = 1.96) {
  const p = w / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}
const toDelta = (p) => 400 * Math.log10(p / (1 - p));

console.log(`有效对局 ${rows.length} 盘 · ${pairs.length} 组 · 阶梯 ${ladderHash ?? '?'}（应用 ${appLadderHash}）`);
console.log(`\n${'对局'.padEnd(7)}${'胜负'.padStart(8)}${'胜率'.padStart(7)}${'Δ'.padStart(8)}${'Δ 95% 区间'.padStart(20)}${'截断'.padStart(6)}`);
for (const p of pairs) {
  const rate = p.w / p.n;
  const [l, u] = wilson(p.w, p.n);
  const dl = l > 0 && l < 1 ? toDelta(l) : NaN;
  const du = u > 0 && u < 1 ? toDelta(u) : NaN;
  console.log(
    `${`${p.lo}v${p.hi}`.padEnd(7)}${`${p.w}/${p.n}`.padStart(8)}${(rate * 100).toFixed(0).padStart(6)}%` +
      `${Number.isFinite(toDelta(rate)) ? toDelta(rate).toFixed(0).padStart(8) : '      —'}` +
      `${`[${Number.isFinite(dl) ? dl.toFixed(0) : '−∞'}, ${Number.isFinite(du) ? du.toFixed(0) : '+∞'}]`.padStart(20)}` +
      `${String(p.capped).padStart(6)}`,
  );
}

/* ---------------- Bradley-Terry MLE ---------------- */

const levels = [...new Set(rows.flatMap((r) => r.pair))].sort((a, b) => a - b);
const free = levels.filter((k) => k !== ANCHOR_LEVEL);
const idx = new Map(free.map((k, i) => [k, i]));
const A = new Map(levels.map((k) => [k, ANCHOR_RATING + (k - ANCHOR_LEVEL) * 100]));
A.set(ANCHOR_LEVEL, ANCHOR_RATING);

const pLo = (al, ah) => 1 / (1 + Math.exp((ah - al) / C));

function newton() {
  for (let iter = 0; iter < 80; iter++) {
    const g = new Array(free.length).fill(0);
    const H = free.map(() => new Array(free.length).fill(0));
    for (const r of rows) {
      const [lo, hi] = r.pair;
      const p = pLo(A.get(lo), A.get(hi));
      const res = (r.loWon ? 1 : 0) - p;
      const w = (p * (1 - p)) / (C * C);
      if (lo !== ANCHOR_LEVEL) {
        const i = idx.get(lo);
        g[i] += res / C;
        H[i][i] += w;
      }
      if (hi !== ANCHOR_LEVEL) {
        const j = idx.get(hi);
        g[j] -= res / C;
        H[j][j] += w;
      }
      if (lo !== ANCHOR_LEVEL && hi !== ANCHOR_LEVEL) {
        const i = idx.get(lo);
        const j = idx.get(hi);
        H[i][j] -= w;
        H[j][i] -= w;
      }
    }
    const dx = solve(H, g);
    if (!dx) break;
    let max = 0;
    for (let i = 0; i < free.length; i++) {
      A.set(free[i], A.get(free[i]) + dx[i]);
      max = Math.max(max, Math.abs(dx[i]));
    }
    if (max < 1e-7) break;
  }
  return { H: hessian(), g: gradient() };
}

function gradient() {
  const g = new Array(free.length).fill(0);
  for (const r of rows) {
    const [lo, hi] = r.pair;
    const p = pLo(A.get(lo), A.get(hi));
    const res = (r.loWon ? 1 : 0) - p;
    if (lo !== ANCHOR_LEVEL) g[idx.get(lo)] += res / C;
    if (hi !== ANCHOR_LEVEL) g[idx.get(hi)] -= res / C;
  }
  return g;
}

function hessian() {
  const H = free.map(() => new Array(free.length).fill(0));
  for (const r of rows) {
    const [lo, hi] = r.pair;
    const p = pLo(A.get(lo), A.get(hi));
    const w = (p * (1 - p)) / (C * C);
    if (lo !== ANCHOR_LEVEL) H[idx.get(lo)][idx.get(lo)] += w;
    if (hi !== ANCHOR_LEVEL) H[idx.get(hi)][idx.get(hi)] += w;
    if (lo !== ANCHOR_LEVEL && hi !== ANCHOR_LEVEL) {
      H[idx.get(lo)][idx.get(hi)] -= w;
      H[idx.get(hi)][idx.get(lo)] -= w;
    }
  }
  return H;
}

function solve(M, b) {
  const n = b.length;
  const m = M.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    const pv = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col || m[r][col] === 0) continue;
      const f = m[r][col];
      for (let j = col; j <= n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

function invert(M) {
  const n = M.length;
  const m = M.map((row, i) => [...row, ...new Array(n).fill(0).map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    const pv = m[col][col];
    for (let j = 0; j < 2 * n; j++) m[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col || m[r][col] === 0) continue;
      const f = m[r][col];
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

const { H } = newton();
const cov = invert(H);
const se = new Map([[ANCHOR_LEVEL, 0]]);
free.forEach((k, i) => se.set(k, cov ? Math.sqrt(Math.max(cov[i][i], 0)) : NaN));

console.log('\nBT 估分（锚点固定，未做单调约束）');
for (const k of levels) {
  const ci = se.get(k);
  console.log(
    `  ${String(k).padStart(2)} 级 ${A.get(k).toFixed(0).padStart(6)}` +
      (Number.isFinite(ci) ? `  ±${(1.96 * ci).toFixed(0)}` : ''),
  );
}

/* ---------------- 线性阶梯（只估斜率） ---------------- */

function nllStep(step) {
  let s = 0;
  for (const r of rows) {
    const p = 1 / (1 + Math.exp((step * (r.pair[1] - r.pair[0])) / C));
    s -= Math.log(r.loWon ? p : 1 - p);
  }
  return s;
}
let bestStep = 0;
let bestNll = Infinity;
for (let s = -200; s <= 400; s += 0.5) {
  const v = nllStep(s);
  if (v < bestNll) {
    bestNll = v;
    bestStep = s;
  }
}
const thr = bestNll + 1.9205; // 单参数 95% 似然比
let loStep = bestStep;
while (loStep > -200 && nllStep(loStep - 0.5) < thr) loStep -= 0.5;
let hiStep = bestStep;
while (hiStep < 400 && nllStep(hiStep + 0.5) < thr) hiStep += 0.5;

console.log(`\n线性阶梯：step = ${bestStep.toFixed(0)} 分，95% 似然区间 [${loStep.toFixed(0)}, ${hiStep.toFixed(0)}]`);

const expectedP = 1 / (1 + Math.exp(bestStep / C));
console.log(`相邻两级：低打高 ${(expectedP * 100).toFixed(0)}%，高打低 ${((1 - expectedP) * 100).toFixed(0)}%`);
const off = pairs.filter((p) => {
  const rate = p.w / p.n;
  const [l, u] = wilson(p.w, p.n);
  return u < expectedP - 0.08 || l > expectedP + 0.08;
});
if (off.length) {
  console.log('偏离线性模型超过 8 个百分点的组：');
  for (const p of off) console.log(`  ${p.lo}v${p.hi}: 实测 ${((p.w / p.n) * 100).toFixed(0)}% vs 期望 ${(expectedP * 100).toFixed(0)}%`);
} else {
  console.log('所有组都在线性模型 ±8 个百分点内。');
}

/* ---------------- 等渗回归（PAVA） ---------------- */

/** 加权保序回归：把 BT 的逐级估分压成单调不减，权重 1/var（方差大的级少动） */
function isotonic(values, weights) {
  const blocks = values.map((v, i) => ({ sum: v * weights[i], w: weights[i], v, members: [i] }));
  for (let i = 1; i < blocks.length; i++) {
    let cur = blocks[i];
    let prev = blocks[i - 1];
    while (prev && cur.v < prev.v) {
      const merged = {
        sum: prev.sum + cur.sum,
        w: prev.w + cur.w,
        v: 0,
        members: [...prev.members, ...cur.members],
      };
      merged.v = merged.sum / merged.w;
      blocks.splice(i - 1, 2, merged);
      i -= 1;
      cur = merged;
      prev = blocks[i - 1];
    }
  }
  const out = new Array(values.length);
  for (const b of blocks) for (const m of b.members) out[m] = b.v;
  return out;
}

const useIsotonic = val('model', 'isotonic') !== 'linear';
const btW = levels.map((k) => {
  const s = se.get(k);
  return Number.isFinite(s) && s > 0 ? 1 / (s * s) : 1e-6;
});
const isoRaw = isotonic(
  levels.map((k) => A.get(k)),
  btW,
);
const anchorIdx = levels.indexOf(ANCHOR_LEVEL);
const shift = ANCHOR_RATING - isoRaw[anchorIdx];
const isoA = new Map(levels.map((k, i) => [k, isoRaw[i] + shift]));

if (useIsotonic) {
  console.log('\n单调化后的等级分（等渗回归，锚点仍在 ' + ANCHOR_LEVEL + ' 级）：');
  for (let i = 0; i < levels.length; i++) {
    const k = levels[i];
    const stepText = i > 0 ? `  Δ=${(isoA.get(k) - isoA.get(levels[i - 1])).toFixed(0)}` : '';
    console.log(`  ${String(k).padStart(2)} 级 ${isoA.get(k).toFixed(0).padStart(6)}${stepText}`);
  }
}

const measured = new Set(levels);
const ratingOfLevel = (k) => (useIsotonic ? isoA.get(k) ?? A.get(k) : ANCHOR_RATING + bestStep * (k - ANCHOR_LEVEL));

const levelSample = new Map();
for (const k of levels) {
  levelSample.set(k, (byPair.get(`${k - 1}-${k}`)?.n ?? 0) + (byPair.get(`${k}-${k + 1}`)?.n ?? 0));
}

/* ---------------- 写 ranks.json ---------------- */

if (has('write')) {
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  // 未测级：按实测中位局部步长外推（若测了 12→13，主模型段按 log2(visits) 换算）
  const localSteps = [];
  for (let k = lo; k < hi; k++) localSteps.push(ratingOfLevel(k + 1) - ratingOfLevel(k));
  const sortedSteps = [...localSteps].sort((a, b) => a - b);
  const medStep = sortedSteps.length ? sortedSteps[Math.floor(sortedSteps.length / 2)] : RATING_FALLBACK;

  const levelsOut = [];
  for (let k = 1; k <= MAX_LEVEL; k++) {
    const isMeasured = measured.has(k);
    const rating = isMeasured
      ? ratingOfLevel(k)
      : k > hi
        ? ratingOfLevel(hi) + medStep * (k - hi)
        : ratingOfLevel(lo) - medStep * (lo - k);
    const sample = levelSample.get(k) ?? 0;
    levelsOut.push({
      level: k,
      rating: Math.round(rating),
      calibrated: isMeasured && sample >= MIN_SAMPLE,
      sample,
      ci95:
        isMeasured && Number.isFinite(se.get(k))
          ? [Math.round(A.get(k) - 1.96 * se.get(k)), Math.round(A.get(k) + 1.96 * se.get(k))]
          : null,
      extrapolated: !isMeasured,
      measuredAt: isMeasured ? new Date().toISOString().slice(0, 19) : undefined,
    });
  }

  // 主模型段：若测过 12→13，就按 log2(visits) 的比例外推 14/15（比套中位步长靠谱）
  const mainPair = byPair.get('12-13');
  if (mainPair && hi >= 13) {
    const d = ratingOfLevel(13) - ratingOfLevel(12);
    const perDouble = d / Math.log2(800 / 300);
    const visits = { 14: [1500, 800], 15: [3000, 1500] };
    for (const k of [14, 15]) {
      if (k <= hi) continue;
      const [a, b] = visits[k];
      const prev = levelsOut.find((l) => l.level === k - 1);
      const cur = levelsOut.find((l) => l.level === k);
      if (!prev || !cur) continue;
      cur.rating = Math.round(prev.rating + perDouble * Math.log2(a / b));
    }
  }

  const stepOfLevel = new Map();
  for (let i = 1; i < levelsOut.length; i++) {
    stepOfLevel.set(levelsOut[i].level - 1, levelsOut[i].rating - levelsOut[i - 1].rating);
  }

  const allOk = levelsOut.every((l) => l.calibrated || l.extrapolated);
  const table = {
    maxLevel: MAX_LEVEL,
    calibrated: allOk && levelsOut.some((l) => l.calibrated),
    calibratedAt: new Date().toISOString().slice(0, 19),
    method: useIsotonic ? 'bt-isotonic' : 'bt-linear-step',
    size: metas[0]?.size ?? 9,
    gamesPerPair: metas[0]?.gamesPerPair ?? null,
    anchor: { level: ANCHOR_LEVEL, rating: ANCHOR_RATING },
    step: Math.round(medStep),
    stepCi95: [Math.round(loStep), Math.round(hiStep)],
    localSteps: Object.fromEntries(stepOfLevel),
    source: sources,
    note:
      `相邻级互下实测 ${rows.length} 盘（${metas[0]?.size ?? 9} 路）：` +
      (useIsotonic
        ? `逐级 A_k 用 BT+等渗回归（中位步长 ${medStep.toFixed(0)} 分），阶梯不要求等距；升级阈值按本级局部步长换算。`
        : `按线性阶梯拟合，${bestStep.toFixed(0)} 分/级（95% 区间 ${loStep.toFixed(0)}~${hiStep.toFixed(0)}）；逐级独立误差过大，故不逐级取值。`) +
      (levelsOut.some((l) => l.extrapolated) ? '未测级为外推，标 extrapolated。' : ''),
    levels: levelsOut,
  };
  fs.writeFileSync(path.join(ROOT, 'data/ranks.json'), JSON.stringify(table, null, 2) + '\n');
  console.log(
    `\n已写入 data/ranks.json：${levelsOut.filter((l) => l.calibrated).length} 级已校准，` +
      `${levelsOut.filter((l) => l.extrapolated).length} 级外推，中位步长 ${medStep.toFixed(0)} 分`,
  );
} else {
  console.log('\n（加 --write 写 data/ranks.json）');
}
