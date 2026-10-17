import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PASS } from '@xingyi/shared';
import { Board } from '@xingyi/rules';
import {
  EngineManager,
  GtpSession,
  buildGtpArgs,
  offlineMove,
  parseAnalyzeLine,
} from '../src/index.js';

const fakePath = fileURLToPath(new URL('./fake-katago.mjs', import.meta.url));
const nodeBin = process.execPath;

function makeManager(): EngineManager {
  return new EngineManager({
    binaryPath: nodeBin,
    modelPath: fakePath,
    humanModelPath: fakePath,
    backend: 'cuda',
    argvOverride: [fakePath, 'gtp', '-model', fakePath],
  });
}

describe('GTP 协议层（假引擎验证）', () => {
  it('串行请求与响应配对正确', async () => {
    const s = new GtpSession({ binary: nodeBin, args: [fakePath] });
    s.start();
    expect(await s.send('name')).toBe('FakeKataGo');
    expect(await s.send('version')).toBe('1.15.3-fake');
    expect(await s.send('boardsize 9')).toBe('');
    // 并发发起：队列保证按顺序、不串号
    const [a, b] = await Promise.all([s.send('name'), s.send('version')]);
    expect(a).toBe('FakeKataGo');
    expect(b).toBe('1.15.3-fake');
    s.stop();
  }, 20000);

  it('错误响应转成异常', async () => {
    const s = new GtpSession({ binary: nodeBin, args: [fakePath] });
    s.start();
    await s.send('boardsize 9');
    await s.send('play B D4');
    await expect(s.send('play W D4')).rejects.toThrow(/illegal move/);
    s.stop();
  }, 20000);

  it('参数模板包含 -model，human 模型按需追加', () => {
    const args = buildGtpArgs({
      binaryPath: 'katago.exe',
      backend: 'cuda',
      modelPath: 'm.bin.gz',
      humanModelPath: 'h.bin.gz',
      configPath: 'g.cfg',
    });
    expect(args[0]).toBe('gtp');
    expect(args).toContain('-model');
    expect(args).toContain('-human-model');
    expect(args).toContain('-config');
  });
});

describe('分析输出解析', () => {
  it('解析候选点、PV 与 ownership', () => {
    const ownership = new Array(81).fill('0.3').join(' ');
    const line =
      'info move D4 visits 120 utility -0.2 winrate 0.5321 scoreLead -1.40 prior 0.21 order 0 ' +
      `pv D4 Q16 C3 unknownField 9 ownership ${ownership}`;
    const parsed = parseAnalyzeLine(line, 9);
    const c = parsed.candidates[0]!;
    expect(c.move).toBe('D4');
    expect(c.visits).toBe(120);
    expect(c.winrate).toBeCloseTo(0.5321, 4);
    expect(c.scoreLead).toBeCloseTo(-1.4, 2);
    expect(c.pv).toEqual(['D4', 'Q16', 'C3']);
    expect(parsed.ownership?.length).toBe(81);
  });

  it('一行里串多个 info 段也能全部解析（真引擎格式）', () => {
    const line =
      'info move Q4 visits 10 winrate 0.4 scoreLead -1 order 0 pv Q4 D16 ' +
      'info move D4 visits 8 winrate 0.42 scoreLead -0.8 order 1 pv D4 Q16 ' +
      'rootInfo visits 300 winrate 0.41 scoreLead -0.9 ownership ' +
      new Array(81).fill('0.2').join(' ');
    const parsed = parseAnalyzeLine(line, 9);
    expect(parsed.candidates.length).toBe(2);
    expect(parsed.candidates.map((c) => c.move)).toEqual(['Q4', 'D4']);
    expect(parsed.rootVisits).toBe(300);
    expect(parsed.ownership?.length).toBe(81);
  });

  it('未知字段不破坏解析（向前兼容）', () => {
    const parsed = parseAnalyzeLine(
      'info move Q16 futureField 42 visits 88 winrate 0.61 scoreLead 3.2 order 1 pv Q16',
      19,
    );
    expect(parsed.candidates[0]?.move).toBe('Q16');
    expect(parsed.candidates[0]?.visits).toBe(88);
  });
});

describe('引擎管理器（假引擎）', () => {
  it('自检通过并识别 human 模型', async () => {
    const mgr = makeManager();
    const res = await mgr.selfCheck();
    expect(res.ok).toBe(true);
    expect(res.version).toBe('1.15.3-fake');
    expect(res.humanSL).toBe(true);
    expect(res.steps.every((s) => s.ok)).toBe(true);
    await mgr.stop();
  }, 30000);

  it('分析拿到候选点与 361 点归属，且能连续分析两次', async () => {
    const mgr = makeManager();
    await mgr.start();
    const first = await mgr.analyze({
      size: 19,
      komi: 7.5,
      moves: [],
      turn: 'B',
      level: 8,
      minDurationMs: 120,
      maxDurationMs: 800,
    });
    expect(first).not.toBeNull();
    expect(first!.candidates.length).toBeGreaterThan(0);
    expect(first!.ownership?.length).toBe(361);
    expect(first!.source).toBe('katago');

    const second = await mgr.analyze({
      size: 19,
      komi: 7.5,
      moves: [{ color: 'B', vertex: 3 * 19 + 3 }],
      turn: 'W',
      level: 12,
      minDurationMs: 120,
      maxDurationMs: 800,
    });
    expect(second).not.toBeNull();
    expect(second!.turn).toBe('W');
    expect(second!.candidates[0]!.order).toBe(0);
    await mgr.stop();
  }, 40000);

  it('走子返回合法点，局面同步不重复建局', async () => {
    const mgr = makeManager();
    await mgr.start();
    const pos = { size: 19, komi: 7.5, moves: [] as { color: 'B' | 'W'; vertex: number }[] };
    const m1 = await mgr.genmove('B', 8, pos);
    expect(m1.vertex).not.toBe(PASS);
    pos.moves.push({ color: 'B', vertex: m1.vertex });
    const m2 = await mgr.genmove('W', 8, pos);
    expect(m2.vertex).not.toBe(m1.vertex);
    await mgr.stop();
  }, 40000);
});

describe('离线对手', () => {
  it('1~15 级都只下合法棋', () => {
    const size = 9;
    const board = new Board(size);
    board.set(40, 1);
    for (const level of [1, 8, 15]) {
      const v = offlineMove({ size, grid: board.grid, toPlay: 'W', level, seed: 7 });
      expect(v).not.toBe(PASS);
      expect(board.at(v)).toBe(0);
      expect(board.isSuicide('W', v)).toBe(false);
    }
  });

  it('同种子结果可复现（便于复现问题）', () => {
    const a = offlineMove({ size: 13, grid: new Array(169).fill(0), toPlay: 'B', level: 5, seed: 42 });
    const b = offlineMove({ size: 13, grid: new Array(169).fill(0), toPlay: 'B', level: 5, seed: 42 });
    expect(a).toBe(b);
  });

  it('局面已定时停手（不填自己的地、不往对方地里送死）', () => {
    const size = 9;
    const grid = new Array(81).fill(0);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) if (x !== 4) grid[y * 9 + x] = 1;
    }
    // 中间一列空着，只被黑包围 → 黑的地盘，谁下进去都没意义
    expect(offlineMove({ size, grid, toPlay: 'B', level: 10 })).toBe(PASS);
    expect(offlineMove({ size, grid, toPlay: 'W', level: 10 })).toBe(PASS);
  });

  it('还有单官可收时不会急着停', () => {
    const size = 9;
    const grid = new Array(81).fill(0);
    // 上半黑、下半白，中间第 4 行空着（单官，双方都能到）
    for (let y = 0; y < 4; y++) for (let x = 0; x < 9; x++) grid[y * 9 + x] = 1;
    for (let y = 5; y < 9; y++) for (let x = 0; x < 9; x++) grid[y * 9 + x] = 2;
    const v = offlineMove({ size, grid, toPlay: 'B', level: 10 });
    expect(v).not.toBe(PASS);
    expect(Math.floor(v / size)).toBe(4);
  });

  it('无处可下时停一手', () => {
    const size = 3;
    const grid = new Array(9).fill(1); // 盘面无空点
    const v = offlineMove({ size, grid, toPlay: 'W', level: 15 });
    expect(v).toBe(PASS);
  });
});
