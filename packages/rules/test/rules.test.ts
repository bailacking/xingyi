import { describe, expect, it } from 'vitest';
import { PASS, gtpToVertex, vertexToGtp } from '@xingyi/shared';
import { Board, Game, parseGrid, scoreArea } from '../src/index.js';

const idx = (size: number, x: number, y: number) => y * size + x;

describe('坐标', () => {
  it('GTP 坐标跳过 I，行列与一维下标互转', () => {
    expect(vertexToGtp(19, idx(19, 0, 0))).toBe('A19');
    expect(vertexToGtp(19, idx(19, 8, 18))).toBe('J1');
    expect(vertexToGtp(19, 360)).toBe('T1');
    expect(vertexToGtp(19, PASS)).toBe('pass');
    for (let v = 0; v < 361; v++) {
      expect(gtpToVertex(19, vertexToGtp(19, v))).toBe(v);
    }
  });
});

describe('提子', () => {
  it('四面包围提掉一子', () => {
    const b = new Board(9);
    b.set(idx(9, 1, 1), 2);
    b.set(idx(9, 0, 1), 1);
    b.set(idx(9, 2, 1), 1);
    b.set(idx(9, 1, 0), 1);
    const res = b.place('B', idx(9, 1, 2));
    expect(res.captured).toEqual([idx(9, 1, 1)]);
    expect(b.at(idx(9, 1, 1))).toBe(0);
  });

  it('一次提掉两子（多子块）', () => {
    const b = new Board(9);
    b.set(idx(9, 1, 1), 2);
    b.set(idx(9, 2, 1), 2);
    for (const [x, y] of [
      [0, 1],
      [3, 1],
      [1, 0],
      [2, 0],
      [1, 2],
    ] as const) {
      b.set(idx(9, x, y), 1);
    }
    const res = b.place('B', idx(9, 2, 2));
    expect(res.captured.sort((a, c) => a - c)).toEqual([idx(9, 1, 1), idx(9, 2, 1)].sort((a, c) => a - c));
  });

  it('单点自杀被拒', () => {
    const g = new Game({
      size: 9,
      komi: 7.5,
      toPlay: 'W',
      setup: {
        black: [idx(9, 0, 1), idx(9, 2, 1), idx(9, 1, 0), idx(9, 1, 2)],
      },
    });
    const r = g.play('W', idx(9, 1, 1));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('suicide');
  });

  it('提掉对方后自己有气 → 不算自杀', () => {
    const b = new Board(9);
    // 白 (1,1)(1,2) 被黑围住，只剩 (1,3) 一口气
    b.set(idx(9, 1, 1), 2);
    b.set(idx(9, 1, 2), 2);
    for (const [x, y] of [
      [1, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [2, 2],
      [0, 3],
      [2, 3],
    ] as const) {
      b.set(idx(9, x, y), 1);
    }
    const res = b.place('B', idx(9, 1, 3));
    expect(res.suicide).toBe(false);
    expect(res.captured.length).toBe(2);
    // 提子后黑子自身获得气（原白子位置）
    expect(b.groupAt(idx(9, 1, 3)).liberties.length).toBeGreaterThan(0);
  });
});

describe('自杀判定的边界（回归：刺/接被误判）', () => {
  it('落子接上自己还有外气的棋 → 合法', () => {
    // 目标点 (2,2) 四邻全是子：左是黑（另有两口气），上/右/下是白
    const size = 9;
    const b = new Board(size);
    b.set(idx(size, 1, 2), 1);
    b.set(idx(size, 2, 1), 2);
    b.set(idx(size, 3, 2), 2);
    b.set(idx(size, 2, 3), 2);
    expect(b.isSuicide('B', idx(size, 2, 2))).toBe(false);
    const g = new Game({ size, komi: 7.5, toPlay: 'B' });
    g.board.set(idx(size, 1, 2), 1);
    g.board.set(idx(size, 2, 1), 2);
    g.board.set(idx(size, 3, 2), 2);
    g.board.set(idx(size, 2, 3), 2);
    expect(g.play('B', idx(size, 2, 2)).ok).toBe(true);
  });

  it('四面被白围死且无己方接应 → 仍是自杀', () => {
    const size = 9;
    const b = new Board(size);
    b.set(idx(size, 2, 1), 2);
    b.set(idx(size, 1, 2), 2);
    b.set(idx(size, 3, 2), 2);
    b.set(idx(size, 2, 3), 2);
    expect(b.isSuicide('B', idx(size, 2, 2))).toBe(true);
  });

  it('随机对局 200 手：盘上任何一块棋都不可能是零气', () => {
    const g = new Game({ size: 9, komi: 7.5 });
    let seed = 20261017;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200 && g.status === 'playing'; i++) {
      const legal = g.board.legalMoves(g.toPlay).filter((v) => g.preview(g.toPlay, v).ok);
      if (legal.length === 0) {
        g.play(g.toPlay, PASS);
        continue;
      }
      const res = g.play(g.toPlay, legal[Math.floor(rnd() * legal.length)]!);
      expect(res.ok).toBe(true);
      for (let p = 0; p < 81; p++) {
        if (g.board.at(p) !== 0) {
          expect(g.board.groupAt(p).liberties.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('劫与 superko', () => {
  it('简单劫：回提被位置超劫禁止', () => {
    const g = new Game({
      size: 9,
      komi: 7.5,
      toPlay: 'B',
      setup: {
        black: [idx(9, 1, 0), idx(9, 0, 1), idx(9, 1, 2)],
        white: [idx(9, 2, 0), idx(9, 1, 1), idx(9, 3, 1), idx(9, 2, 2)],
      },
    });
    const take = g.play('B', idx(9, 2, 1));
    expect(take.ok).toBe(true);
    expect(take.captured).toEqual([idx(9, 1, 1)]);

    const recapture = g.play('W', idx(9, 1, 1));
    expect(recapture.ok).toBe(false);
    expect(recapture.error).toBe('superko');
  });

  it('找劫材后可以回提', () => {
    const g = new Game({
      size: 9,
      komi: 7.5,
      toPlay: 'B',
      setup: {
        black: [idx(9, 1, 0), idx(9, 0, 1), idx(9, 1, 2)],
        white: [idx(9, 2, 0), idx(9, 1, 1), idx(9, 3, 1), idx(9, 2, 2)],
      },
    });
    g.play('B', idx(9, 2, 1));
    expect(g.play('W', idx(9, 8, 0)).ok).toBe(true); // 劫材
    expect(g.play('B', idx(9, 8, 1)).ok).toBe(true); // 应劫
    const recapture = g.play('W', idx(9, 1, 1));
    expect(recapture.ok).toBe(true);
    expect(recapture.captured).toEqual([idx(9, 2, 1)]);
  });

  it('双方停手 → 进入数子阶段', () => {
    const g = new Game({ size: 9, komi: 7.5 });
    g.play('B', PASS);
    expect(g.status).toBe('playing');
    g.play('W', PASS);
    expect(g.status).toBe('scoring');
  });
});

describe('悔棋', () => {
  it('回到开局后盘面为空、轮次正确', () => {
    const g = new Game({ size: 9, komi: 7.5 });
    g.play('B', idx(9, 2, 2));
    g.play('W', idx(9, 6, 6));
    g.play('B', idx(9, 4, 4));
    expect(g.ply).toBe(3);
    g.undoTo(0);
    expect(g.ply).toBe(0);
    expect(g.toPlay).toBe('B');
    expect(Array.from(g.board.grid).every((c) => c === 0)).toBe(true);
    expect(g.captures).toEqual({ B: 0, W: 0 });
  });

  it('悔棋还原被提的子与提子计数', () => {
    const g = new Game({
      size: 9,
      komi: 7.5,
      toPlay: 'B',
      setup: {
        white: [idx(9, 1, 1)],
        black: [idx(9, 0, 1), idx(9, 2, 1), idx(9, 1, 0)],
      },
    });
    g.play('B', idx(9, 1, 2));
    expect(g.captures.W).toBe(1);
    g.undoTo(0);
    expect(g.board.at(idx(9, 1, 1))).toBe(2);
    expect(g.captures.W).toBe(0);
  });
});

describe('数子（中国规则）', () => {
  it('上下各占四路，中间一路是单官', () => {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) {
      if (y < 4) rows.push('XXXXXXXXX');
      else if (y === 4) rows.push('.........');
      else rows.push('OOOOOOOOO');
    }
    const grid = parseGrid(9, rows);
    const r = scoreArea(9, grid, 7.5);
    expect(r.blackArea).toBe(36);
    expect(r.whiteArea).toBe(36);
    expect(r.diff).toBe(-7.5);
    expect(r.winner).toBe('W');
    expect(r.margin).toBe(7.5);
  });

  it('确认死子后地域变化', () => {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) {
      if (y === 4) rows.push('....X.O..');
      else rows.push('....X.O..');
    }
    const grid = parseGrid(9, rows);
    // 左边 4 列只碰黑，右边 2 列只碰白，第 6 列两边都碰（单官）
    const base = scoreArea(9, grid, 0);
    expect(base.blackArea).toBe(45);
    expect(base.whiteArea).toBe(27);

    // 黑阵中放一颗白死子：该块地域变成争议，黑只剩子
    grid[idx(9, 2, 4)] = 2;
    const contested = scoreArea(9, grid, 0);
    expect(contested.blackArea).toBe(9);

    const dead = scoreArea(9, grid, 0, [idx(9, 2, 4)]);
    expect(dead.blackArea).toBe(45);
  });

  it('空盘全是单官，不算地域', () => {
    const r = scoreArea(9, new Uint8Array(81), 7.5);
    expect(r.blackArea).toBe(0);
    expect(r.whiteArea).toBe(0);
    expect(r.winner).toBe('W');
  });
});
