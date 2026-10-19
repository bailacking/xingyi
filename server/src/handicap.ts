import type { BoardSize, Vertex } from '@xingyi/shared';

/**
 * 让子（置石）位置。用的是常规星位布局，不是"随便摆"。
 *
 * 2 子是对角的两颗（右上 + 左下），之后按「补角 → 中间/边中」的顺序加，
 * 7 子与 9 子带天元，8 子是四角四边中（不含天元）——这是通行摆法，别自创顺序。
 *
 * 让子局：黑棋先摆好 N 颗，**白先走**，贴目按 0.5 算（中国规则让子局通常不贴或贴 0.5）。
 */
const LAYOUT: Record<number, ('tl' | 'tr' | 'bl' | 'br' | 'l' | 'r' | 't' | 'b' | 'c')[]> = {
  2: ['tr', 'bl'],
  3: ['tr', 'bl', 'br'],
  4: ['tr', 'bl', 'br', 'tl'],
  5: ['tr', 'bl', 'br', 'tl', 'c'],
  6: ['tr', 'bl', 'br', 'tl', 'l', 'r'],
  7: ['tr', 'bl', 'br', 'tl', 'l', 'r', 'c'],
  8: ['tr', 'bl', 'br', 'tl', 'l', 'r', 't', 'b'],
  9: ['tr', 'bl', 'br', 'tl', 'l', 'r', 't', 'b', 'c'],
};

/** 星位到边的距离：19 路 3、13 路 3、9 路 2 */
function starGap(size: BoardSize): number {
  if (size <= 9) return 2;
  return 3;
}

export function handicapStones(size: BoardSize, n: number): Vertex[] {
  const count = Math.max(0, Math.min(9, Math.round(n)));
  if (count < 2) return [];
  const gap = starGap(size);
  const lo = gap;
  const hi = size - 1 - gap;
  const mid = Math.floor((size - 1) / 2);
  const at = (key: string): Vertex => {
    switch (key) {
      case 'tl':
        return lo * size + lo;
      case 'tr':
        return lo * size + hi;
      case 'bl':
        return hi * size + lo;
      case 'br':
        return hi * size + hi;
      case 'l':
        return mid * size + lo;
      case 'r':
        return mid * size + hi;
      case 't':
        return lo * size + mid;
      case 'b':
        return hi * size + mid;
      default:
        return mid * size + mid;
    }
  };
  return LAYOUT[count]!.map(at);
}

/** 让子局的贴目：让 2 子及以上默认 0.5 */
export function handicapKomi(handicap: number, fallback: number): number {
  return handicap >= 2 ? 0.5 : fallback;
}
