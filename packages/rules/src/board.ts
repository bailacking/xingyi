import { PASS, neighbors, type Color, type Vertex } from '@xingyi/shared';

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type CellColor = typeof EMPTY | typeof BLACK | typeof WHITE;

export function colorCode(color: Color): 1 | 2 {
  return color === 'B' ? BLACK : WHITE;
}

export function codeToColor(code: number): Color | null {
  return code === BLACK ? 'B' : code === WHITE ? 'W' : null;
}

export function opposite(color: Color): Color {
  return color === 'B' ? 'W' : 'B';
}

export interface Group {
  stones: Vertex[];
  liberties: Vertex[];
}

/** 盘面。只管「子与气」，劫与 superko 在 Game 层判定。 */
export class Board {
  readonly size: number;
  readonly grid: Uint8Array;

  constructor(size: number, grid?: Uint8Array | number[]) {
    this.size = size;
    this.grid = grid instanceof Uint8Array ? Uint8Array.from(grid) : new Uint8Array(size * size);
    if (grid) {
      for (let i = 0; i < this.grid.length; i++) this.grid[i] = grid[i] ?? 0;
    }
  }

  clone(): Board {
    return new Board(this.size, this.grid);
  }

  /** 返回 cell 颜色码 0/1/2；越界返回 0。 */
  at(v: Vertex): number {
    if (v < 0 || v >= this.grid.length) return EMPTY;
    return this.grid[v]!;
  }

  set(v: Vertex, code: CellColor): void {
    this.grid[v] = code;
  }

  /** 盘面指纹（不含轮次）：superko 与缓存 key 都靠它。 */
  fingerprint(): string {
    let s = '';
    for (let i = 0; i < this.grid.length; i++) s += this.grid[i];
    return s;
  }

  /** 洪泛取整块棋与气。 */
  groupAt(v: Vertex): Group {
    const color = this.at(v);
    if (color === EMPTY) return { stones: [], liberties: [] };
    const seen = new Uint8Array(this.grid.length);
    const liberties = new Uint8Array(this.grid.length);
    const stones: Vertex[] = [];
    const stack: Vertex[] = [v];
    seen[v] = 1;
    const nb: Vertex[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      stones.push(cur);
      neighbors(this.size, cur, nb);
      for (const n of nb) {
        const c = this.grid[n]!;
        if (c === EMPTY) liberties[n] = 1;
        else if (c === color && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const libs: Vertex[] = [];
    for (let i = 0; i < liberties.length; i++) if (liberties[i]) libs.push(i);
    return { stones, liberties: libs };
  }

  /**
   * 该点在给定颜色下是否为自杀（未考虑劫）。
   *
   * 唯一正确的判法就是**照着落一手看结果**：既要算提掉对方后腾出的气，
   * 也要算连上自己人后共用的气。手写"有没有空邻点/能不能提子"会漏掉
   * 「落子接上自己那块还有外气的棋」——那是最常见的合法点（接、刺、挖）。
   */
  isSuicide(color: Color, v: Vertex): boolean {
    if (this.at(v) !== EMPTY) return false;
    const copy = this.clone();
    return copy.place(color, v).suicide;
  }

  /**
   * 落子并提子（就地修改）。不判劫、不判轮次。
   * 返回被提掉的对方棋子下标。
   */
  place(color: Color, v: Vertex): { captured: Vertex[]; suicide: boolean } {
    if (v === PASS) return { captured: [], suicide: false };
    const code = colorCode(color);
    const opp = code === BLACK ? WHITE : BLACK;
    this.grid[v] = code;
    const captured: Vertex[] = [];
    const nb: Vertex[] = [];
    neighbors(this.size, v, nb);
    const checked = new Set<Vertex>();
    for (const n of nb) {
      if (this.grid[n] !== opp || checked.has(n)) continue;
      const g = this.groupAt(n);
      for (const s of g.stones) checked.add(s);
      if (g.liberties.length === 0) {
        for (const s of g.stones) {
          this.grid[s] = EMPTY;
          captured.push(s);
        }
      }
    }
    if (captured.length === 0) {
      const own = this.groupAt(v);
      if (own.liberties.length === 0) {
        this.grid[v] = EMPTY;
        return { captured: [], suicide: true };
      }
    }
    return { captured, suicide: false };
  }

  /** 当前盘面全部合法点（不含劫争判定）。 */
  legalMoves(color: Color): Vertex[] {
    const out: Vertex[] = [];
    for (let v = 0; v < this.grid.length; v++) {
      if (this.grid[v] !== EMPTY) continue;
      if (!this.isSuicide(color, v)) out.push(v);
    }
    return out;
  }

  toArray(): number[] {
    return Array.from(this.grid);
  }
}

export function createBoard(size: number): Board {
  return new Board(size);
}
