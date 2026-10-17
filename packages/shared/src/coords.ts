import { PASS, type BoardSize, type Vertex } from './types.js';

/** GTP 坐标字母：跳过 I（容易与 1 混淆，行业惯例）。 */
export const GTP_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

export function toIndex(size: number, x: number, y: number): Vertex {
  return y * size + x;
}

export function vertexX(size: number, v: Vertex): number {
  return v % size;
}

export function vertexY(size: number, v: Vertex): number {
  return Math.floor(v / size);
}

export function isValidVertex(size: number, v: Vertex): boolean {
  return Number.isInteger(v) && v >= 0 && v < size * size;
}

/** 四个正交邻居（不越界）。 */
export function neighbors(size: number, v: Vertex, out: Vertex[] = []): Vertex[] {
  out.length = 0;
  const x = v % size;
  const y = (v / size) | 0;
  if (x > 0) out.push(v - 1);
  if (x < size - 1) out.push(v + 1);
  if (y > 0) out.push(v - size);
  if (y < size - 1) out.push(v + size);
  return out;
}

/** 一维下标 → GTP 坐标，如 361 路盘的 0 → "A19"。PASS → "pass"。 */
export function vertexToGtp(size: number, v: Vertex): string {
  if (v === PASS) return 'pass';
  if (!isValidVertex(size, v)) return 'invalid';
  const x = v % size;
  const y = (v / size) | 0;
  return `${GTP_LETTERS[x]}${size - y}`;
}

/** GTP 坐标 → 一维下标；无法解析返回 PASS。 */
export function gtpToVertex(size: number, s: string): Vertex {
  const t = s.trim().toUpperCase();
  if (t === 'PASS') return PASS;
  const m = /^([A-HJ-Z])(\d{1,2})$/.exec(t);
  if (!m) return PASS;
  const x = GTP_LETTERS.indexOf(m[1]!);
  const row = Number(m[2]);
  if (x < 0 || x >= size) return PASS;
  const y = size - row;
  if (y < 0 || y >= size) return PASS;
  return y * size + x;
}

/** SGF 坐标（aa = 左上角，含 i） */
export function vertexToSgf(size: number, v: Vertex): string {
  if (v === PASS) return '';
  const x = v % size;
  const y = (v / size) | 0;
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

export function sgfToVertex(size: number, s: string): Vertex {
  if (!s || s.length < 2) return PASS;
  const x = s.charCodeAt(0) - 97;
  const y = s.charCodeAt(1) - 97;
  if (x < 0 || y < 0 || x >= size || y >= size) return PASS;
  return y * size + x;
}

/** 人读坐标（界面用）：与 GTP 同形，如 "Q16"。 */
export function coordLabel(size: number, v: Vertex): string {
  return vertexToGtp(size, v);
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 正文写法：1 → 一级，12 → 十二级（PLAN §11.2）。 */
export function levelCn(level: number): string {
  const n = Math.max(0, Math.floor(level));
  if (n <= 10) return n === 10 ? '十级' : `${CN_DIGITS[n]}级`;
  if (n < 20) return `十${CN_DIGITS[n % 10]}级`;
  return `${CN_DIGITS[Math.floor(n / 10)]}十${n % 10 ? CN_DIGITS[n % 10] : ''}级`;
}

const CN_FORMAL = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];

/** 印章内的大写：6 → 陆级（一寸见方的印，用大写才像印）。 */
export function levelCnFormal(level: number): string {
  const n = Math.max(1, Math.floor(level));
  if (n <= 10) return `${CN_FORMAL[n]}级`;
  if (n < 20) return `拾${CN_FORMAL[n % 10]}级`;
  return `${CN_FORMAL[Math.floor(n / 10)]}拾${n % 10 ? CN_FORMAL[n % 10] : ''}级`;
}

export function starPoints(size: number): Vertex[] {
  const pts: Vertex[] = [];
  if (size === 9) {
    for (const y of [2, 6]) for (const x of [2, 6]) pts.push(toIndex(size, x, y));
    pts.push(toIndex(size, 4, 4));
  } else if (size === 13) {
    for (const y of [3, 9]) for (const x of [3, 9]) pts.push(toIndex(size, x, y));
    pts.push(toIndex(size, 6, 6));
  } else if (size === 19) {
    for (const y of [3, 9, 15]) for (const x of [3, 9, 15]) pts.push(toIndex(size, x, y));
  }
  return pts;
}
