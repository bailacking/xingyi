import type { Color, Vertex } from '@xingyi/shared';
import type { Board } from './board.js';

/**
 * 着法名：只给**几何上确定**的几种，拿不准就不标（返回 undefined）。
 *
 * 这里刻意不做「扳/挡/压/镇/飞封」那套细分——它们的定义依赖全局棋形与意图，
 * 用局部规则硬猜会给出误人子弟的标签。当前只标：
 * 提子 / 打吃 / 接 / 长 / 立 / 跳 / 飞 / 尖。
 *
 * 判定顺序（先命中先返回，避免一手既像飞又像尖时乱标）：
 * 提子 > 打吃 > 接 > 立 > 长 > 跳 > 飞 > 尖
 */
export function moveName(
  before: Board,
  after: Board,
  color: Color,
  vertex: Vertex,
  captured: number,
): string | undefined {
  const size = before.size;
  if (vertex < 0 || vertex >= size * size) return undefined;
  const x = vertex % size;
  const y = Math.floor(vertex / size);
  const mine = color === 'B' ? 1 : 2;
  const theirs = color === 'B' ? 2 : 1;

  if (captured > 0) return '提子';

  // 打吃：落子后相邻敌块只剩一口气
  for (const [nx, ny] of neighbors(size, x, y)) {
    const v = ny * size + nx;
    if (after.at(v) !== theirs) continue;
    if (after.groupAt(v).liberties.length === 1) return '打吃';
  }

  // 相邻的己方块（按成员去重，避免同一块被数成两块）
  const groups = new Map<string, number[]>();
  for (const [nx, ny] of neighbors(size, x, y)) {
    const v = ny * size + nx;
    if (before.at(v) !== mine) continue;
    const stones = [...before.groupAt(v).stones];
    groups.set([...stones].sort((a, b) => a - b).join(','), stones);
  }
  if (groups.size >= 2) return '接';

  if (groups.size === 1) {
    // 沿直线连着自己的棋，且那块棋在这个方向上不止一颗 → 长
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ax = x - dx;
      const ay = y - dy;
      if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
      if (before.at(ay * size + ax) !== mine) continue;
      let run = 0;
      let cx = ax;
      let cy = ay;
      while (cx >= 0 && cy >= 0 && cx < size && cy < size && before.at(cy * size + cx) === mine) {
        run += 1;
        cx -= dx;
        cy -= dy;
      }
      if (run < 2) continue;
      // 立：这一手比它接的那颗更靠边（把棋往边线立下去）
      const edge = (px: number, py: number): number => Math.min(px, py, size - 1 - px, size - 1 - py);
      return edge(x, y) < edge(ax, ay) ? '立' : '长';
    }
    return undefined;
  }

  // 不挨着自己的棋：跳 / 飞 / 尖
  const has = (dx: number, dy: number): boolean => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < size && ny < size && before.at(ny * size + nx) === mine;
  };
  // 跳：同一行/列隔一个空点
  for (const [dx, dy] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ] as const) {
    if (has(dx, dy) && before.at((y + dy / 2) * size + (x + dx / 2)) === 0) return '跳';
  }
  // 飞：小飞（日字），挡住中间点也算飞
  for (const [dx, dy] of [
    [2, 1],
    [1, 2],
    [-2, 1],
    [-1, 2],
    [2, -1],
    [1, -2],
    [-2, -1],
    [-1, -2],
  ] as const) {
    if (has(dx, dy)) return '飞';
  }
  // 尖：斜对角
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    if (has(dx, dy)) return '尖';
  }
  return undefined;
}

function* neighbors(size: number, x: number, y: number): Generator<[number, number]> {
  if (x > 0) yield [x - 1, y];
  if (x < size - 1) yield [x + 1, y];
  if (y > 0) yield [x, y - 1];
  if (y < size - 1) yield [x, y + 1];
}
