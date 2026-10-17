import { describe, expect, it } from 'vitest';
import { PASS } from '@xingyi/shared';
import { parseSgf, toSgf } from '../src/sgf.js';

describe('SGF', () => {
  it('导出后能原样读回（含摆子）', () => {
    const sgf = toSgf({
      size: 19,
      komi: 7.5,
      moves: [
        { color: 'B', vertex: 3 * 19 + 3 },
        { color: 'W', vertex: 15 * 19 + 15 },
        { color: 'B', vertex: PASS },
      ],
      setup: { black: [0], white: [18] },
      playerBlack: '大帅',
      result: 'B+3.5',
    });
    const parsed = parseSgf(sgf);
    expect(parsed.size).toBe(19);
    expect(parsed.komi).toBe(7.5);
    expect(parsed.setup.black).toEqual([0]);
    expect(parsed.setup.white).toEqual([18]);
    expect(parsed.mainLine.length).toBe(3);
    expect(parsed.mainLine[2]!.vertex).toBe(PASS);
    expect(parsed.result).toBe('B+3.5');
    expect(parsed.playerBlack).toBe('大帅');
  });

  it('解析变体分支，主线取第一条', () => {
    const text = '(;GM[1]SZ[9];B[ee](;W[cc];B[gg])(;W[gc]))';
    const parsed = parseSgf(text);
    expect(parsed.mainLine.length).toBe(3);
    expect(parsed.mainLine[1]!.color).toBe('W');
    // 主线走 cc（x=2,y=2）
    expect(parsed.mainLine[1]!.vertex).toBe(2 * 9 + 2);
    expect(parsed.variationCount).toBe(1);
  });

  it('属性值里的 ] 与反斜杠被正确转义', () => {
    const sgf = toSgf({
      size: 9,
      komi: 6.5,
      moves: [],
      playerBlack: 'a]b\\c',
    });
    const parsed = parseSgf(sgf);
    expect(parsed.playerBlack).toBe('a]b\\c');
  });

  it('读 PL 属性决定谁先走；摆子局面默认白先', () => {
    expect(parseSgf('(;GM[1]SZ[9]PL[W];B[ee])').firstPlayer).toBe('W');
    expect(parseSgf('(;GM[1]SZ[9];B[ee])').firstPlayer).toBe('B');
    const setupOnly = parseSgf('(;GM[1]SZ[9]AB[ee][cc])');
    expect(setupOnly.firstPlayer).toBe('W');
  });

  it('空内容给出明确错误', () => {
    expect(() => parseSgf('')).toThrow();
  });
});
