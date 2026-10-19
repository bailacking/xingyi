/**
 * 生成死活题库（提子题）。
 *
 * 做法：枚举 1~6 子的白棋连通形状 → 在 9 路棋盘的角/边/中摆位 → 用黑子封住除一口气外的所有气 →
 * **用规则引擎逐题验算**（白只剩 1 气、正解提子数等于白块大小、盘面无零气棋块）。
 * 验不过的组合直接丢弃，所以题库里不存在「题目本身是错的」。
 *
 * 用法：node scripts/gen-tsumego.mjs [--count 100] [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../packages/rules/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const val = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const COUNT = Number(val('count', 100));
const WRITE = argv.includes('--write');
const SIZE = 9;
const DEBUG = process.env.DEBUG_TSUMEGO === '1';
const why = (m) => {
  if (DEBUG) console.log('  skip:', m);
  return null;
};

/* ---------------- 形状：枚举自由多连块 ---------------- */

const canon = (cells) => {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([x, y]) => `${x - minX},${y - minY}`)
    .sort()
    .join(';');
};

function polyominoes(n) {
  let set = new Map([[canon([[0, 0]]), [[0, 0]]]]);
  for (let k = 1; k < n; k++) {
    const next = new Map();
    for (const cells of set.values()) {
      const has = new Set(cells.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of cells) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const p = [x + dx, y + dy];
          if (has.has(`${p[0]},${p[1]}`)) continue;
          const grown = [...cells, p];
          next.set(canon(grown), grown);
        }
      }
    }
    set = next;
  }
  return [...set.values()];
}

/* ---------------- 摆位 ---------------- */

const anchors = () => {
  const list = [];
  for (const [x, y] of [
    [0, 0],
    [SIZE, 0],
    [0, SIZE],
    [SIZE, SIZE],
    [0, 4],
    [4, 0],
    [4, 8],
    [8, 4],
    [4, 4],
  ]) {
    list.push([x, y]);
  }
  return list;
};

const idx = (x, y) => y * SIZE + x;

/**
 * @param {{cells:number[][], anchor:number[], solution:[number,number]}} spec
 * @returns {null | {grid:number[], solution:number, capture:number, dead:number[]}}
 */
function buildAndVerify(spec) {
  const { cells, anchor, solution } = spec;
  const [ax, ay] = anchor;
  // 形状按锚点在角/边时贴边：把 bounding box 推到对应角落
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const ox = ax === SIZE ? SIZE - w : ax;
  const oy = ay === SIZE ? SIZE - h : ay;
  const white = cells.map(([x, y]) => [x + ox, y + oy]);
  if (white.some(([x, y]) => x < 0 || y < 0 || x >= SIZE || y >= SIZE)) return why('越界');

  const whiteSet = new Set(white.map(([x, y]) => idx(x, y)));
  // 白块的所有气
  const libs = new Set();
  for (const [x, y] of white) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const v = idx(nx, ny);
      if (!whiteSet.has(v)) libs.add(v);
    }
  }
  if (libs.size < 2) return why('气不足');

  const solV = idx(solution[0], solution[1]);
  if (!libs.has(solV)) return why('解点不在气里');
  const black = [...libs].filter((v) => v !== solV).map((v) => [v % SIZE, Math.floor(v / SIZE)]);

  const grid = new Array(SIZE * SIZE).fill(0);
  for (const [x, y] of black) grid[idx(x, y)] = 1;
  for (const [x, y] of white) grid[idx(x, y)] = 2;

  // 用规则引擎验：白只剩 1 气；黑下正解提子数 == 白块大小；盘上无零气棋块
  const probe = new Game({
    size: SIZE,
    komi: 7.5,
    toPlay: 'B',
    setup: { black: black.map(([x, y]) => idx(x, y)), white: [...whiteSet] },
  });
  const libOfWhite = new Set();
  for (const v of whiteSet) for (const l of probe.board.groupAt(v).liberties) libOfWhite.add(l);
  if (libOfWhite.size !== 1 || !libOfWhite.has(solV)) return why('白气数 ' + libOfWhite.size);

  const res = probe.play('B', solV);
  if (!res.ok) return why('落子被拒 ' + res.error);
  const captured = res.captured?.length ?? 0;
  if (captured !== whiteSet.size) return why('提子数 ' + captured);

  // 落子后任何棋块都不能没气（规则引擎的硬不变量）
  for (let v = 0; v < grid.length; v++) {
    if (probe.board.at(v) && probe.board.groupAt(v).liberties.length === 0) return why('落子后有零气块');
  }
  // 黑子本身在被提之前不能是零气（不可能出现的局面）
  const pre = new Game({
    size: SIZE,
    komi: 7.5,
    toPlay: 'B',
    setup: { black: black.map(([x, y]) => idx(x, y)), white: [...whiteSet] },
  });
  for (const [x, y] of black) {
    if (pre.board.groupAt(idx(x, y)).liberties.length === 0) return why('黑子零气');
  }

  return { grid, solution: solV, capture: captured, dead: [...whiteSet] };
}

/* ---------------- 选题 ---------------- */

const levelOf = (n) => (n <= 2 ? '入门' : n <= 4 ? '进阶' : '挑战');

const picked = [];
const seen = new Set();
const basis = {};
// 配额按形状稀缺程度分配（1 子只有 1 种形状 × 9 个摆位，所以少给）
const QUOTA = { 1: 9, 2: 10, 3: 20, 4: 21, 5: 20, 6: 20 };
const total = Object.values(QUOTA).reduce((a, b) => a + b, 0);
if (total !== COUNT) {
  console.error(`配额合计 ${total} ≠ COUNT ${COUNT}，改 QUOTA`);
  process.exit(1);
}
const anchorOrder = anchors();

for (let n = 1; n <= 6; n++) {
  const shapes = polyominoes(n);
  basis[n] = shapes.length;
  let taken = 0;
  // 摆位在外层、形状在内层 → 题目在棋盘上分布更散，不会一色堆在角落
  for (const anchor of anchorOrder) {
    for (const cells of shapes) {
      if (taken >= QUOTA[n]) break;
      // 锚点里的 SIZE 是"贴右/贴下"的哨兵，要按这块白棋自身的宽高折算左上角
      const cw = Math.max(...cells.map((c) => c[0])) + 1;
      const ch = Math.max(...cells.map((c) => c[1])) + 1;
      const ox = anchor[0] === SIZE ? SIZE - cw : anchor[0];
      const oy = anchor[1] === SIZE ? SIZE - ch : anchor[1];
      const white = cells.map(([x, y]) => [x + ox, y + oy]);
      if (white.some(([x, y]) => x < 0 || y < 0 || x >= SIZE || y >= SIZE)) continue;
      const whiteSet = new Set(white.map(([x, y]) => idx(x, y)));
      const libs = [];
      for (const [x, y] of white) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
          const v = idx(nx, ny);
          if (!whiteSet.has(v) && !libs.includes(v)) libs.push(v);
        }
      }
      if (libs.length < 2) continue;
      const solved = buildAndVerify({ cells, anchor, solution: [libs[0] % SIZE, Math.floor(libs[0] / SIZE)] });
      if (!solved) continue;
      const key = solved.grid.join('');
      if (seen.has(key)) continue;
      seen.add(key);
      if (DEBUG) console.log('  take n=' + n + ' anchor=' + anchor.join(',') + ' key=' + key.slice(0, 12) + '… len=' + key.length);
      picked.push({
        size: n,
        level: levelOf(n),
        grid: solved.grid,
        solution: solved.solution,
        capture: solved.capture,
      });
      taken += 1;
    }
    if (taken >= QUOTA[n]) break;
  }
  if (taken < QUOTA[n]) {
    console.error(`${n} 子形状只凑到 ${taken} 题（配额 ${QUOTA[n]}）`);
    process.exit(1);
  }
}

// 排序：先按白块大小，同大小按「靠角 → 靠边 → 中央」的锚点顺序（观感上由易到难）
const sorted = picked.sort((a, b) => a.size - b.size);

const problems = sorted.map((p, i) => ({
  id: `g${String(i + 1).padStart(3, '0')}`,
  title: `提${p.capture === 1 ? '一' : p.capture === 2 ? '两' : p.capture === 3 ? '三' : p.capture === 4 ? '四' : p.capture === 5 ? '五' : p.capture}子`,
  level: p.level,
  size: SIZE,
  komi: 7.5,
  toPlay: 'B',
  grid: p.grid,
  solutions: [p.solution],
  capture: p.capture,
  hint: '白棋只剩一口气，找出来。',
}));

console.log(`形状数：${Object.entries(basis).map(([k, v]) => `${k}子=${v}`).join(' ')}`);
console.log(`生成并验证通过：${problems.length} 题（要求 ${COUNT}）`);
const byLevel = problems.reduce((a, p) => ({ ...a, [p.level]: (a[p.level] ?? 0) + 1 }), {});
console.log('难度分布：', byLevel);

if (problems.length < COUNT) {
  console.error('题目数量不足，别写文件');
  process.exit(1);
}

if (WRITE) {
  const file = path.join(ROOT, 'data/tsumego/index.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        version: 2,
        generator: 'scripts/gen-tsumego.mjs（每题都用规则引擎验算过）',
        note: '自建题库（CC0）。判题以「这一手提子数 ≥ capture」为准，所以多种正解都能过。',
        problems,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('已写入', file);
} else {
  console.log('（加 --write 写 data/tsumego/index.json）');
}
