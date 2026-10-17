import { PASS, neighbors, type Color, type Vertex } from '@xingyi/shared';
import { Board, colorCode, opposite } from '@xingyi/rules';

/**
 * 离线对手：**不是 KataGo**，是程序自带的启发式陪练。
 *
 * 用途：没装引擎时也能把界面、规则、流程跑通（自由模式试玩）。
 * 它的棋力是"能下、不荒唐"，**绝不用于修习模式的进度结算**（见 server 的模式门禁）。
 * 随机数固定种子 → 同一局面同一步，便于复现问题。
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OfflineMoveRequest {
  size: number;
  grid: number[] | Uint8Array;
  toPlay: Color;
  /** 1..15；越低越随机 */
  level: number;
  seed?: number;
  /** 上一手位置，用来做"就近应对" */
  lastMove?: Vertex | null;
}

function linePreference(size: number, v: Vertex): number {
  const x = v % size;
  const y = (v / size) | 0;
  const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
  if (edge === 0) return -1.6;
  if (edge === 1) return 0.4;
  if (edge === 2) return 1.2;
  if (edge === 3) return 1.4;
  return 0.6;
}

/** 选一手棋；返回 PASS 表示认输式停手（只在无处可下时）。 */
export function offlineMove(req: OfflineMoveRequest): Vertex {
  const board = new Board(req.size, req.grid);
  const me = req.toPlay;
  const opp = opposite(me);
  const myCode = colorCode(me);
  const oppCode = colorCode(opp);
  const legal = board.legalMoves(me);
  if (legal.length === 0) return PASS;

  const level = Math.max(1, Math.min(15, Math.round(req.level)));
  const skill = (level - 1) / 14; // 0..1
  const noise = (1 - skill) * 26 + 2;
  const rnd = mulberry32((req.seed ?? 1) * 2654435761);

  let best: Vertex = legal[0]!;
  let bestScore = -Infinity;
  const nb: Vertex[] = [];

  for (const v of legal) {
    const sim = board.clone();
    const res = sim.place(me, v);
    if (res.suicide) continue;

    const own = sim.groupAt(v);
    let score = 0;

    // 提子：最重要的直接收益
    score += res.captured.length * (7 + skill * 6);

    // 自己被打吃是坏棋；但"弃子"在高等级允许
    if (own.liberties.length === 1 && res.captured.length === 0) score -= 9 + skill * 6;
    else if (own.liberties.length === 2) score -= 1.5;

    // 自己的气越多越好（略微）
    score += Math.min(own.liberties.length, 6) * (0.35 + skill * 0.18);

    // 顺手威胁对方（对方只剩一口气的块）
    neighbors(req.size, v, nb);
    for (const n of nb) {
      if (sim.at(n) !== oppCode) continue;
      const g = sim.groupAt(n);
      if (g.liberties.length === 1) score += 3.5 + skill * 3;
    }

    // 连自己人（不要下成孤子）
    let friends = 0;
    for (const n of nb) if (sim.at(n) === myCode) friends++;
    score += friends * (0.4 + skill * 0.4);

    // 靠近上一手（像人在应手）
    if (req.lastMove !== undefined && req.lastMove !== null && req.lastMove >= 0) {
      const dx = Math.abs((v % req.size) - (req.lastMove % req.size));
      const dy = Math.abs(((v / req.size) | 0) - ((req.lastMove / req.size) | 0));
      const dist = Math.max(dx, dy);
      if (dist <= 2) score += 1.2 + skill * 0.8;
      else if (dist >= 6) score -= 1.2;
    }

    // 布局期偏好三四线
    let stones = 0;
    for (let i = 0; i < sim.grid.length; i++) if (sim.grid[i]) stones++;
    if (stones < req.size * req.size * 0.35) score += linePreference(req.size, v);

    score += rnd() * noise;

    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}
