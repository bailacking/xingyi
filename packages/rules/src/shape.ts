import type { Color, Vertex } from '@xingyi/shared';
import type { Board } from './board.js';

/**
 * 着法名：只给**几何上确定**的几种，拿不准就不标（返回 undefined）。
 *
 * 这里刻意不做「压/托/碰/靠/挤/刺」那套细分——它们的定义依赖全局棋形与意图，
 * 用局部规则硬猜会给出误人子弟的标签。当前只标：
 * 提子 / 打吃 / 接 / 扳 / 挡 / 镇 / 长 / 立 / 跳 / 飞 / 尖。
 *
 * 扳、挡、镇 的判据都要求几何唯一，拿不准一律不标：
 * - 扳：斜对角有己方子，且这手贴着的敌方子正是那颗己方子的邻子（对方「长」的位置）；
 * - 挡：正面顶住对方一条同色直线（敌方子背后还有同色子），不猜「护空」的挡；
 * - 镇：与敌子隔一路、更靠中腹、不接触敌子。
 *
 * 判定顺序（先命中先返回，避免一手既像飞又像尖时乱标）：
 * 提子 > 打吃 > 接 > 扳 > 挡 > 镇 > 立 > 长 > 跳 > 飞 > 尖
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

  // 不挨着自己的棋：扳 / 挡 / 镇 / 跳 / 飞 / 尖
  const at2 = (px: number, py: number): number =>
    px >= 0 && py >= 0 && px < size && py < size ? before.at(py * size + px) : -1;
  const has = (dx: number, dy: number): boolean => at2(x + dx, y + dy) === mine;

  // 扳：双方贴紧时，从斜对角走到对方「长」的位置。
  // 几何：斜对角有自己的子，且这手正交贴着的敌方子正是那颗己方子的邻子
  //      （即 e = (x±1, y) 或 (x, y±1)，紧贴斜对角的己方子）。
  // 反例：斜对角是自己的子但中间没敌方子（那是「尖」，不是扳）。
  let hane = 0;
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    if (at2(x + dx, y + dy) !== mine) continue;
    if (at2(x + dx, y) === theirs || at2(x, y + dy) === theirs) hane += 1;
  }
  if (hane > 0) return '扳';

  // 挡：迎头拦住对方正在延伸的一条线。
  // 几何：正交贴着一颗敌方子，且那颗子沿着「远离这手」的方向还有同色邻子
  //      （对方的冲/长被正面顶住）。
  // 只认贴紧的迎头拦，不猜「护空」那种意图性的挡。
  for (const [nx, ny] of neighbors(size, x, y)) {
    if (before.at(ny * size + nx) !== theirs) continue;
    const bx = 2 * nx - x;
    const by = 2 * ny - y;
    if (at2(bx, by) === theirs) return '挡';
  }

  // 镇：在对方棋子向中腹「跳」的位置上下子。
  // 几何：敌方子在同一行/列隔一路（中间是空点），且这手比那颗子更靠棋盘中心；
  //      反过来（往边线压）不叫镇。要求这手不接触任何敌子，否则是贴身的扳/挡。
  const enemyContact = [...neighbors(size, x, y)].some(
    ([nx, ny]) => before.at(ny * size + nx) === theirs,
  );
  if (!enemyContact) {
    const c = (size - 1) / 2;
    const dist2 = (px: number, py: number): number => (px - c) ** 2 + (py - c) ** 2;
    for (const [dx, dy] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ] as const) {
      if (at2(x + dx, y + dy) !== theirs) continue;
      if (before.at((y + dy / 2) * size + (x + dx / 2)) !== 0) continue;
      if (dist2(x, y) < dist2(x + dx, y + dy)) return '镇';
    }
  }

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
