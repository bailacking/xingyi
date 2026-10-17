import { neighbors, type Vertex } from '@xingyi/shared';
import { BLACK, EMPTY, WHITE, type Board } from './board.js';

export interface ScoreDetailLocal {
  blackArea: number;
  whiteArea: number;
  komi: number;
  diff: number;
  winner: 'B' | 'W' | null;
  margin: number;
  blackTerritory: Vertex[];
  whiteTerritory: Vertex[];
}

/**
 * 中国规则数子（AGENTS.md §7）：只算地域 = 己方子 + 只被己方包围的空点，
 * 不数俘虏；白方加贴目。争议点（双方都能到的空点）为单官，不算。
 *
 * @param dead 已确认的死子；先按空点处理（数子规则下等价于被对方提掉）
 */
export function scoreArea(
  size: number,
  grid: Uint8Array | number[],
  komi: number,
  dead: Vertex[] = [],
): ScoreDetailLocal {
  const g = Uint8Array.from(grid as ArrayLike<number>);
  for (const d of dead) if (d >= 0 && d < g.length) g[d] = EMPTY;

  const visited = new Uint8Array(g.length);
  const blackTerritory: Vertex[] = [];
  const whiteTerritory: Vertex[] = [];
  let blackStones = 0;
  let whiteStones = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === BLACK) blackStones++;
    else if (g[i] === WHITE) whiteStones++;
  }

  const region: Vertex[] = [];
  const nb: Vertex[] = [];
  for (let start = 0; start < g.length; start++) {
    if (g[start] !== EMPTY || visited[start]) continue;
    region.length = 0;
    let touchBlack = false;
    let touchWhite = false;
    const stack: Vertex[] = [start];
    visited[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      region.push(cur);
      neighbors(size, cur, nb);
      for (const n of nb) {
        const c = g[n]!;
        if (c === BLACK) touchBlack = true;
        else if (c === WHITE) touchWhite = true;
        else if (!visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    if (touchBlack && !touchWhite) blackTerritory.push(...region);
    else if (touchWhite && !touchBlack) whiteTerritory.push(...region);
    // 两边都碰到 / 都没碰到 → 单官或空盘，不计数
  }

  const blackArea = blackStones + blackTerritory.length;
  const whiteArea = whiteStones + whiteTerritory.length;
  const diff = Math.round((blackArea - (whiteArea + komi)) * 10) / 10;
  const winner = diff > 0 ? 'B' : diff < 0 ? 'W' : null;
  return {
    blackArea,
    whiteArea,
    komi,
    diff,
    winner,
    margin: Math.abs(diff),
    blackTerritory: blackTerritory.sort((a, b) => a - b),
    whiteTerritory: whiteTerritory.sort((a, b) => a - b),
  };
}

/** 数子结果 → 中文结论（如「黑胜 3.5 目」）。 */
export function scoreText(r: ScoreDetailLocal): string {
  if (!r.winner) return '和棋';
  return `${r.winner === 'B' ? '黑' : '白'}胜 ${r.margin} 目`;
}

/** 仅供测试与调试：从字符串盘面构造。'X'=黑 'O'=白 '.'=空 */
export function parseGrid(size: number, rows: string[]): Uint8Array {
  const g = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < size; x++) {
      const ch = row[x] ?? '.';
      g[y * size + x] = ch === 'X' ? BLACK : ch === 'O' ? WHITE : EMPTY;
    }
  }
  return g;
}

export function boardToRows(board: Board): string[] {
  const rows: string[] = [];
  for (let y = 0; y < board.size; y++) {
    let row = '';
    for (let x = 0; x < board.size; x++) {
      const c = board.at(y * board.size + x);
      row += c === BLACK ? 'X' : c === WHITE ? 'O' : '.';
    }
    rows.push(row);
  }
  return rows;
}
