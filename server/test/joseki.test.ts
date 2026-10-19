import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineManager } from '@xingyi/engine';
import { Game } from '@xingyi/rules';
import { DEFAULT_KOMI, vertexToGtp } from '@xingyi/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { GameService, ServiceError } from '../src/gameService.js';
import { checkJoseki, getJoseki, listJoseki, loadJoseki, validateJoseki } from '../src/joseki.js';
import { dataPaths } from '../src/paths.js';

/**
 * 定式是**数据**，和题库一样会手改，所以这里对仓库里真正发货的那份逐手验算：
 * 每一步都得在 19 路空盘上合法，判手得能分出对错，提示要是「第 N 手应下 X」。
 */

const entries = loadJoseki();

describe('定式数据（data/joseki/index.json）', () => {
  it('至少 6 个定式，id 唯一，字段齐全，黑白交替从黑开始', () => {
    expect(entries.length).toBeGreaterThanOrEqual(6);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const e of entries) {
      expect(e.size).toBe(19);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.category.length).toBeGreaterThan(0);
      expect(e.note.length).toBeGreaterThan(8);
      expect(e.steps.length).toBeGreaterThanOrEqual(3);
      e.steps.forEach((s, i) => expect(s.color).toBe(i % 2 === 0 ? 'B' : 'W'));
    }
  });

  it('每一步在 19 路空盘上都合法，走完没有零气棋块', () => {
    const failures: string[] = [];
    for (const e of entries) {
      for (const issue of validateJoseki(e)) failures.push(`${e.id}：${issue}`);
    }
    expect(failures).toEqual([]);
  });

  it('落点都在左上角（前 6 列、前 8 行内），不是盘中央', () => {
    for (const e of entries) {
      for (const s of e.steps) {
        const x = s.vertex % e.size;
        const y = Math.floor(s.vertex / e.size);
        expect(x).toBeLessThanOrEqual(5);
        expect(y).toBeLessThanOrEqual(7);
      }
    }
  });

  it('不会把同一手重复下两遍（数据手改最常见的错）', () => {
    for (const e of entries) {
      expect(new Set(e.steps.map((s) => s.vertex)).size).toBe(e.steps.length);
    }
  });

  it('黑白棋子都真的有子落在盘上（不是空序列或纯摆子）', () => {
    for (const e of entries) {
      const game = new Game({ size: e.size, komi: DEFAULT_KOMI });
      for (const s of e.steps) expect(game.play(s.color, s.vertex).ok).toBe(true);
      const black = e.steps.filter((s) => s.color === 'B').length;
      const white = e.steps.length - black;
      expect(black).toBeGreaterThan(0);
      expect(white).toBeGreaterThan(0);
    }
  });
});

describe('判手（服务端定式模块）', () => {
  it('列表与详情不含答案坐标，只给手数与先后手', () => {
    const list = listJoseki();
    expect(list.length).toBe(entries.length);
    for (const item of list) {
      expect(JSON.stringify(item)).not.toContain('vertex');
    }
    const view = getJoseki(entries[0].id);
    expect(view.total).toBe(entries[0].steps.length);
    expect(view.colors).toHaveLength(view.total);
    expect(JSON.stringify(view)).not.toContain('vertex');
  });

  it('每一手走对都判对，最后一手才 done', () => {
    for (const e of entries) {
      e.steps.forEach((s, i) => {
        const res = checkJoseki(e.id, i, s.vertex);
        expect(res.correct).toBe(true);
        expect(res.done).toBe(i === e.steps.length - 1);
        expect(res.step).toBe(i);
        expect(res.total).toBe(e.steps.length);
      });
    }
  });

  it('走错给出「第 N 手应下 X」，expected 是该手的 GTP 坐标', () => {
    for (const e of entries) {
      const wrong = e.size * e.size - 1; // T1：空盘上永远合法，但绝不是角上的定式点
      const res = checkJoseki(e.id, 0, wrong);
      const expected = vertexToGtp(e.size, e.steps[0].vertex);
      expect(res.correct).toBe(false);
      expect(res.done).toBe(false);
      expect(res.expected).toBe(expected);
      expect(res.message).toContain(`第 1 手应下 ${expected}`);
    }
  });

  it('走到一半走错，提示的是那一步的手数（不是第 1 手）', () => {
    const e = entries[0];
    const res = checkJoseki(e.id, 2, e.size * e.size - 1);
    const expected = vertexToGtp(e.size, e.steps[2].vertex);
    expect(res.correct).toBe(false);
    expect(res.expected).toBe(expected);
    expect(res.message).toContain(`第 3 手应下 ${expected}`);
  });

  it('把对方的子当自己的点下（已有子）也判错，并说清原因', () => {
    const e = entries[0];
    const res = checkJoseki(e.id, 1, e.steps[0].vertex);
    expect(res.correct).toBe(false);
    expect(res.message).toContain('已有棋子');
  });

  it('手数 / 落点越界给中文 400，找不到给 404', () => {
    const e = entries[0];
    expect(() => checkJoseki(e.id, e.steps.length, e.steps[0].vertex)).toThrow(ServiceError);
    expect(() => checkJoseki(e.id, -1, e.steps[0].vertex)).toThrow('手数不对');
    expect(() => checkJoseki(e.id, 0, e.size * e.size)).toThrow('落点不在棋盘上');
    expect(() => checkJoseki('does-not-exist', 0, 60)).toThrow('没有这个定式');
    expect(() => getJoseki('does-not-exist')).toThrow('没有这个定式');
  });
});

describe('定式 HTTP 路由', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-joseki-'));
  const paths = dataPaths(dir);
  const service = new GameService(paths, new EngineManager(loadConfig(paths.configFile).engine));
  const app = createApp(service);

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/joseki 返回列表', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/joseki' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { joseki: { id: string; moves: number }[] };
    expect(body.joseki.length).toBeGreaterThanOrEqual(6);
    expect(body.joseki.every((j) => j.moves >= 3)).toBe(true);
  });

  it('GET /api/joseki/:id 不给答案', async () => {
    const id = entries[0].id;
    const res = await app.inject({ method: 'GET', url: `/api/joseki/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; total: number; colors: string[] };
    expect(body.id).toBe(id);
    expect(body.total).toBe(entries[0].steps.length);
    expect(body.colors).toHaveLength(body.total);
    expect(JSON.stringify(body)).not.toContain('vertex');
  });

  it('POST check：对 / 错 / 缺参数 / 找不到', async () => {
    const e = entries[0];
    const good = await app.inject({
      method: 'POST',
      url: `/api/joseki/${e.id}/check`,
      payload: { step: 0, vertex: e.steps[0].vertex },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().correct).toBe(true);

    const bad = await app.inject({
      method: 'POST',
      url: `/api/joseki/${e.id}/check`,
      payload: { step: 0, vertex: e.size * e.size - 1 },
    });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().correct).toBe(false);
    expect(bad.json().expected).toBe(vertexToGtp(e.size, e.steps[0].vertex));

    const noStep = await app.inject({
      method: 'POST',
      url: `/api/joseki/${e.id}/check`,
      payload: { vertex: e.steps[0].vertex },
    });
    expect(noStep.statusCode).toBe(400);

    const missing = await app.inject({ method: 'GET', url: '/api/joseki/no-such-joseki' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toContain('定式');
  });
});
