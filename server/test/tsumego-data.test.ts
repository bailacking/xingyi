import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Game } from '@xingyi/rules';

/**
 * 题库是**数据**，不是代码——数据也会错，所以这里对仓库里真正发货的那份逐题验算。
 * 生成脚本（scripts/gen-tsumego.mjs）验过一遍，这条测试守的是「以后手改/替换题库」的情况。
 */

const FILE = fileURLToPath(new URL('../../data/tsumego/index.json', import.meta.url));

interface Problem {
  id: string;
  title: string;
  level: string;
  size: 9 | 13 | 19;
  komi: number;
  toPlay: 'B' | 'W';
  grid: number[];
  solutions: number[];
  capture: number;
  hint: string;
}

const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { problems: Problem[] };
const problems = raw.problems;

describe('题库数据（data/tsumego/index.json）', () => {
  it('至少 100 题，id 唯一、字段合法', () => {
    expect(problems.length).toBeGreaterThanOrEqual(100);
    const ids = new Set(problems.map((p) => p.id));
    expect(ids.size).toBe(problems.length);
    for (const p of problems) {
      expect([9, 13, 19]).toContain(p.size);
      expect(p.grid.length).toBe(p.size * p.size);
      expect(p.grid.every((c) => c === 0 || c === 1 || c === 2)).toBe(true);
      expect(p.solutions.length).toBeGreaterThan(0);
      expect(p.capture).toBeGreaterThan(0);
      expect(p.toPlay).toBe('B');
    }
  });

  it('每题：白棋只剩一口气，正解确实提得掉 capture 子，且落子后没有零气块', () => {
    const failures: string[] = [];
    for (const p of problems) {
      const setup = { black: [] as number[], white: [] as number[] };
      p.grid.forEach((c, i) => {
        if (c === 1) setup.black.push(i);
        if (c === 2) setup.white.push(i);
      });
      const libs = new Set<number>();
      const probe = new Game({ size: p.size, komi: p.komi, toPlay: 'B', setup });
      for (const v of setup.white) for (const l of probe.board.groupAt(v).liberties) libs.add(l);
      if (libs.size !== 1) {
        failures.push(`${p.id} 白棋有 ${libs.size} 口气（应恰好 1 口）`);
        continue;
      }
      const sol = p.solutions[0]!;
      if (!libs.has(sol)) failures.push(`${p.id} 正解不在白棋的气里`);
      const game = new Game({ size: p.size, komi: p.komi, toPlay: 'B', setup });
      const res = game.play('B', sol);
      if (!res.ok) {
        failures.push(`${p.id} 正解被规则拒绝：${res.error}`);
        continue;
      }
      const got = res.captured?.length ?? 0;
      if (got !== p.capture) failures.push(`${p.id} 正解提了 ${got} 子，题目声称 ${p.capture}`);
      for (let v = 0; v < p.grid.length; v++) {
        if (game.board.at(v) && game.board.groupAt(v).liberties.length === 0) {
          failures.push(`${p.id} 落子后有零气棋块`);
          break;
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('难度标签只用三档，且都有题目', () => {
    const levels = new Set(problems.map((p) => p.level));
    expect([...levels].sort()).toEqual(['入门', '进阶', '挑战'].sort());
    for (const lv of levels) {
      expect(problems.filter((p) => p.level === lv).length).toBeGreaterThan(0);
    }
  });
});
