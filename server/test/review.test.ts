import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { EngineManager } from '@xingyi/engine';
import type { AnalysisResult } from '@xingyi/shared';
import { GameService } from '../src/gameService.js';
import { dataPaths } from '../src/paths.js';

/**
 * 复盘分块逻辑：不需要真 KataGo，用一个立即返回的假引擎就能验
 * 「每次请求只前进一块」「进度递增」「能中断且保留已算部分」。
 */
class FakeEngine extends EventEmitter {
  ready = true;
  calls = 0;

  async analyze(req: { moves: unknown[]; turn: 'B' | 'W' }): Promise<AnalysisResult> {
    this.calls += 1;
    // 目差随局面缓慢摆动，保证既出好手也出失误，summary/byColor 才有内容
    const lead = Math.round((Math.sin(req.moves.length) * 4 + 0.5) * 10) / 10;
    return {
      turn: req.turn,
      fingerprint: `fake-${req.moves.length}`,
      rootVisits: 120,
      candidates: [
        { move: 'Q16', vertex: 0, visits: 120, winrate: 0.5, scoreLead: lead, prior: 0.2, order: 0, pv: [] },
      ],
      ownership: null,
      source: 'katago',
      elapsedMs: 1,
    };
  }
}

const SGF_COORD = 'abcdefghij';

/** 26 手、彼此不接触的 9 路棋谱（不会提子，回放稳定） */
function makeSgf(): string {
  const black: [number, number][] = [
    [0, 2],
    [2, 2],
    [4, 2],
    [6, 2],
    [8, 2],
    [0, 4],
    [2, 4],
    [4, 4],
    [6, 4],
    [8, 4],
    [0, 6],
    [2, 6],
    [4, 6],
  ];
  const white: [number, number][] = [
    [1, 2],
    [3, 2],
    [5, 2],
    [7, 2],
    [1, 4],
    [3, 4],
    [5, 4],
    [7, 4],
    [1, 6],
    [3, 6],
    [5, 6],
    [7, 6],
    [3, 0],
  ];
  let body = '';
  for (let i = 0; i < 13; i++) {
    const [bx, by] = black[i]!;
    const [wx, wy] = white[i]!;
    body += `;B[${SGF_COORD[bx]}${SGF_COORD[by]}]`;
    if (i < 13) body += `;W[${SGF_COORD[wx]}${SGF_COORD[wy]}]`;
  }
  return `(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[7.5]` + body + ')';
}

function makeService(): { service: GameService; engine: FakeEngine } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-review-'));
  const paths = dataPaths(dir);
  const engine = new FakeEngine();
  const service = new GameService(paths, engine as unknown as EngineManager);
  return { service, engine };
}

describe('复盘分块（假引擎）', () => {
  it('每次只前进一块，进度递增，点数跟着涨', async () => {
    const { service } = makeService();
    const { match } = service.importSgf(makeSgf());
    expect(match.moveList().length).toBe(26);

    const first = await service.review(match.id);
    expect(first.available).toBe(true);
    if (!first.available) return;
    expect(first.result.progress!.total).toBe(27); // 26 手 + 开局局面
    expect(first.result.progress!.done).toBe(12);
    expect(first.result.progress!.running).toBe(true);
    expect(first.result.points.length).toBe(11); // 已评估 12 个局面 → 11 手结论
    expect(first.result.progress!.cancelled).toBe(false);

    const second = await service.review(match.id);
    if (!second.available) throw new Error('should be available');
    expect(second.result.progress!.done).toBe(24);
    expect(second.result.points.length).toBe(23);
    expect(second.result.progress!.running).toBe(true);

    const third = await service.review(match.id);
    if (!third.available) throw new Error('should be available');
    expect(third.result.progress!.done).toBe(27);
    expect(third.result.progress!.running).toBe(false);
    expect(third.result.points.length).toBe(26);
    expect(third.result.truncated).toBe(false);

    // 分色统计必须自洽：各档相加 = 总手数
    const s = third.result.summary;
    const b = s.byColor.B;
    const w = s.byColor.W;
    for (const k of ['good', 'normal', 'mistake', 'unknown'] as const) {
      expect(b[k] + w[k]).toBe(s[k]);
    }
    expect(s.good + s.normal + s.mistake + s.unknown).toBe(26);

    // 再来一次不应重算（作业已完成）
    const again = await service.review(match.id);
    if (!again.available) throw new Error('should be available');
    expect(again.result.progress!.done).toBe(27);
    expect(again.result.points.length).toBe(26);
  });

  it('中断后保留已算部分，下一次轮询给出 cancelled 快照', async () => {
    const { service } = makeService();
    const { match } = service.importSgf(makeSgf());

    const first = await service.review(match.id);
    if (!first.available) throw new Error('should be available');
    expect(first.result.progress!.running).toBe(true);

    expect(service.cancelReview(match.id).cancelled).toBe(true);
    const after = await service.review(match.id);
    if (!after.available) throw new Error('should be available');
    expect(after.result.progress!.running).toBe(false);
    expect(after.result.progress!.cancelled).toBe(true);
    expect(after.result.points.length).toBe(11); // 没继续往下算
    // 再点一次中断不会报错，只是没东西可中断
    expect(service.cancelReview(match.id).cancelled).toBe(false);
  });

  it('引擎没就绪时给中文原因，不建作业', async () => {
    const { service, engine } = makeService();
    const { match } = service.importSgf(makeSgf());
    engine.ready = false;
    const res = await service.review(match.id);
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.reason).toContain('引擎未就绪');
    expect(engine.calls).toBe(0);
  });
});

describe('复盘结果口径（黑方视角，别翻反）', () => {
  it('黑方目差上升 → 黑方不亏；黑方目差下降 → 黑方亏', async () => {
    const { service } = makeService();
    const { match } = service.importSgf(makeSgf());
    const res = await service.review(match.id);
    if (!res.available) throw new Error('should be available');
    // 假引擎 lead = sin(已下手数)*4 + 0.5：k=0 → 0.5，k=1 → 3.87，k=2 → 4.14
    expect(res.result.points[0]!.scoreLeadBlack).toBeCloseTo(0.5, 3);
    expect(res.result.points[0]!.loss).toBe(0); // 黑方把目差从 0.5 抬到 3.87，不亏
    expect(res.result.points[1]!.loss).toBeCloseTo(0.2, 1); // 白方把目差从 3.9 抬到 4.1 → 黑亏 0.2
    expect(res.result.size).toBe(9);
    expect(res.result.komi).toBe(7.5);
  });
});
