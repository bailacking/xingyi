import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineManager } from '@xingyi/engine';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { GameService } from '../src/gameService.js';
import { dataPaths } from '../src/paths.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-api-'));
const paths = dataPaths(dir);
const service = new GameService(paths, new EngineManager(loadConfig(paths.configFile).engine));
const app = createApp(service);

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const idx = (size: number, x: number, y: number) => y * size + x;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('服务端 REST', () => {
  it('健康检查与启动数据', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const boot = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    const data = boot.json();
    expect(data.engine.state).toBe('unconfigured');
    expect(data.modes.ranked.allowUndo).toBe(false);
    expect(data.progress.level).toBe(8);
    expect(data.progress.placement.done).toBe(false);
  });

  it('不传 size 时默认 19 路（回归：曾经 size 变 undefined，棋盘变空）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', playerColor: 'B', level: 3 },
    });
    const snap = created.json().snapshot;
    expect(snap.size).toBe(19);
    expect(snap.grid.length).toBe(361);
  });

  it('未配置引擎时修习模式被拒（中文原因）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/game', payload: { mode: 'ranked' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('KataGo');
  });

  it('自在模式：落子 → 离线对手应手', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 5 },
    });
    expect(created.statusCode).toBe(200);
    const { snapshot, opponent } = created.json();
    expect(opponent).toBe('offline');
    expect(snapshot.size).toBe(9);
    const id = snapshot.id as string;

    const mv = await app.inject({
      method: 'POST',
      url: `/api/game/${id}/move`,
      payload: { vertex: idx(9, 4, 4) },
    });
    expect(mv.statusCode).toBe(200);

    await sleep(120);
    const after = (await app.inject({ method: 'GET', url: `/api/game/${id}` })).json();
    expect(after.snapshot.moves.length).toBe(2);
    expect(after.snapshot.moves[0].color).toBe('B');
    expect(after.snapshot.moves[1].color).toBe('W');
    expect(after.snapshot.toPlay).toBe('B');
  });

  it('非法落子返回 400 与中文原因', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 1 },
    });
    const id = created.json().snapshot.id as string;
    await app.inject({ method: 'POST', url: `/api/game/${id}/move`, payload: { vertex: idx(9, 2, 2) } });
    const dup = await app.inject({ method: 'POST', url: `/api/game/${id}/move`, payload: { vertex: idx(9, 2, 2) } });
    expect(dup.statusCode).toBe(400);
    expect(typeof dup.json().error).toBe('string');
  });

  it('自在模式可以悔棋，主线回到指定手数', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 1 },
    });
    const id = created.json().snapshot.id as string;
    await app.inject({ method: 'POST', url: `/api/game/${id}/move`, payload: { vertex: idx(9, 3, 3) } });
    const undo = await app.inject({ method: 'POST', url: `/api/game/${id}/undo`, payload: { to: 0 } });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().snapshot.moves.length).toBe(0);
    expect(undo.json().snapshot.grid.every((c: number) => c === 0)).toBe(true);
  });

  it('无参 POST 但带 application/json 空 body 也不能 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 2 },
    });
    const id = created.json().snapshot.id as string;
    const res = await app.inject({
      method: 'POST',
      url: `/api/game/${id}/pass`,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('导入 SGF → 双方停手 → 确认死子 → 数子结束', async () => {
    const sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[7.5];B[ee];W[cc];B[gg])';
    const imported = await app.inject({ method: 'POST', url: '/api/sgf/import', payload: { text: sgf } });
    expect(imported.statusCode).toBe(200);
    const body = imported.json();
    expect(body.snapshot.moves.length).toBe(3);
    const id = body.snapshot.id as string;

    const p1 = await app.inject({ method: 'POST', url: `/api/game/${id}/pass` });
    expect(p1.statusCode).toBe(200);
    const p2 = await app.inject({ method: 'POST', url: `/api/game/${id}/pass` });
    expect(p2.json().snapshot.status).toBe('scoring');

    const preview = await app.inject({ method: 'POST', url: `/api/game/${id}/score`, payload: { dead: [] } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toHaveProperty('blackArea');

    const finish = await app.inject({ method: 'POST', url: `/api/game/${id}/finish`, payload: { dead: [] } });
    expect(finish.statusCode).toBe(200);
    const done = finish.json();
    expect(done.snapshot.status).toBe('finished');
    expect(done.snapshot.result.text).toMatch(/胜|和/);
    expect(done.settlement.counted).toBe(false);
  });

  it('「终局」能把对局推进到数子并算出胜负（不依赖引擎）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 3 },
    });
    const id = created.json().snapshot.id as string;
    await app.inject({ method: 'POST', url: `/api/game/${id}/move`, payload: { vertex: idx(9, 4, 4) } });
    await sleep(120);

    const end = await app.inject({ method: 'POST', url: `/api/game/${id}/end` });
    expect(end.statusCode).toBe(200);
    expect(end.json().snapshot.status).toBe('scoring');

    const finish = await app.inject({ method: 'POST', url: `/api/game/${id}/finish`, payload: { dead: [] } });
    expect(finish.statusCode).toBe(200);
    const snap = finish.json().snapshot;
    expect(snap.status).toBe('finished');
    expect(snap.result.text).toMatch(/胜|和/);
    expect(snap.score.blackArea).toBeGreaterThan(0);
  });

  it('自在模式分析在未配置引擎时给出中文说明而不是报错', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 3 },
    });
    const id = created.json().snapshot.id as string;
    const res = await app.inject({ method: 'POST', url: `/api/game/${id}/analyze`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
    expect(res.json().reason).toContain('引擎');
  });

  it('导出 SGF 可取回', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 1 },
    });
    const id = created.json().snapshot.id as string;
    await app.inject({ method: 'POST', url: `/api/game/${id}/move`, payload: { vertex: idx(9, 2, 2) } });
    const sgf = await app.inject({ method: 'GET', url: `/api/game/${id}/sgf` });
    expect(sgf.statusCode).toBe(200);
    expect(sgf.body.startsWith('(;GM[1]')).toBe(true);
    expect(sgf.body).toContain('SZ[9]');
  });

  it('评级沙盘：连赢 12 盘会升几级，且不动存档', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/progress' })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulate/ranked',
      payload: { pattern: 'win', games: 12 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timeline.length).toBe(12);
    expect(body.end.level).toBeGreaterThan(body.start.level);
    expect(body.timeline.every((g: { deltaR: number }) => g.deltaR > 0)).toBe(true);
    const after = (await app.inject({ method: 'GET', url: '/api/progress' })).json();
    expect(after.level).toBe(before.level);
    expect(after.gamesTotal).toBe(before.gamesTotal);
  });

  it('修改名字写进进度', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/progress/name', payload: { name: '大帅' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().playerName).toBe('大帅');
  });
});
