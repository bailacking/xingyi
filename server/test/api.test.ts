import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    expect(data.progress.level).toBe(13);
    expect(data.progress.maxLevel).toBe(25);
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

  it('局域网同源访客可建房，主机配置、评级与对局接口仅限本机', async () => {
    const address = Object.values(os.networkInterfaces()).flat().find((item) => item?.family === 'IPv4' && !item.internal)?.address;
    const host = address ?? os.hostname().toLowerCase();
    const guest = { remoteAddress: address ?? '127.0.0.1', headers: { host, origin: `http://${host}` } };
    const lan = await app.inject({ ...guest, url: '/api/lan' });
    expect(lan.statusCode).toBe(200);
    expect(lan.headers['access-control-allow-origin']).toBeUndefined();
    const room = await app.inject({ ...guest, method: 'POST', url: '/api/room', payload: { clientId: 'f'.repeat(32) } });
    expect(room.statusCode).toBe(200);
    for (const url of ['/api/bootstrap', '/api/progress/export', '/api/matches']) {
      expect((await app.inject({ ...guest, url })).statusCode).toBe(403);
    }
    expect((await app.inject({ ...guest, method: 'PUT', url: '/api/config', payload: { playerName: '测试' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/bootstrap', headers: { origin: 'http://example.test' } })).statusCode).toBe(403);
  });

  it('修习固定 19 路分先、重复开局续下原局，数子使用引擎结果', async () => {
    const rankedPaths = dataPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-ranked-')));
    const engine = new EngineManager({ humanModelPath: 'test-model' });
    engine.status.state = 'ready';
    vi.spyOn(engine, 'genmove').mockResolvedValue({ vertex: -1, resign: false, raw: 'pass' });
    const judge = vi.spyOn(engine, 'finalDead').mockResolvedValue([]);
    const rankedApp = createApp(new GameService(rankedPaths, engine));
    try {
      const start = await rankedApp.inject({ method: 'POST', url: '/api/game', payload: { mode: 'ranked', size: 9, komi: 0.5, handicap: 9 } });
      expect(start.statusCode).toBe(200);
      const { snapshot } = start.json();
      expect(snapshot).toMatchObject({ size: 19, komi: 7.5, handicap: 0, level: 13 });
      const again = await rankedApp.inject({ method: 'POST', url: '/api/game', payload: { mode: 'ranked' } });
      expect(again.json().snapshot.id).toBe(snapshot.id);
      const url = `/api/game/${snapshot.id}`;
      expect((await rankedApp.inject({ method: 'POST', url: `${url}/review` })).json().available).toBe(false);
      expect((await rankedApp.inject({ url: `${url}/sgf` })).statusCode).toBe(403);
      expect((await rankedApp.inject({ method: 'POST', url: `${url}/pass` })).statusCode).toBe(200);
      expect((await rankedApp.inject({ method: 'POST', url: `${url}/finish`, payload: { dead: [0] } })).statusCode).toBe(400);
      const final = await rankedApp.inject({ method: 'POST', url: `${url}/finish` });
      expect(final.statusCode).toBe(200);
      expect(final.json().settlement.counted).toBe(true);
      expect(judge).toHaveBeenCalledTimes(1);
      const next = await rankedApp.inject({ method: 'POST', url: '/api/game', payload: { mode: 'ranked' } });
      expect(next.json().snapshot).toMatchObject({ level: 19, playerColor: 'W' });
      expect((await rankedApp.inject({ method: 'POST', url: '/api/saves', payload: { name: '第二档' } })).statusCode).toBe(409);
      expect((await rankedApp.inject({ method: 'DELETE', url: '/api/saves/legacy' })).statusCode).toBe(409);
    } finally {
      await rankedApp.close();
    }
  });

  it('存档独立、可导出切换，删除最后一档后重启也不会恢复旧档', async () => {
    const savePaths = dataPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-saves-')));
    const start = () => createApp(new GameService(savePaths, new EngineManager()));
    const first = start();
    let secondId: string;
    try {
      await first.inject({ method: 'POST', url: '/api/progress/name', payload: { name: '原有存档' } });
      const created = await first.inject({ method: 'POST', url: '/api/saves', payload: { name: '新存档' } });
      expect(created.statusCode).toBe(200);
      secondId = created.json().activeId;
      expect(created.json().saves).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'legacy', name: '原有存档' }),
        expect.objectContaining({ id: secondId, name: '新存档' }),
      ]));
      const exported = await first.inject({ url: '/api/saves/legacy/export' });
      expect(exported.headers['content-disposition']).toContain('attachment');
      expect(exported.json().progress.playerName).toBe('原有存档');
      const active = await first.inject({ method: 'POST', url: '/api/saves/legacy/activate' });
      expect(active.json().activeId).toBe('legacy');
      const stale = await first.inject({ method: 'POST', url: '/api/game', payload: { mode: 'ranked', saveId: secondId } });
      expect(stale.json().error).toContain('存档已切换');
      expect((await first.inject({ method: 'DELETE', url: '/api/saves/legacy' })).json().activeId).toBe(secondId);
      expect((await first.inject({ method: 'DELETE', url: `/api/saves/${secondId}` })).json().saves).toEqual([]);
      expect((await first.inject({ url: '/api/saves/legacy/export' })).statusCode).toBe(404);
      expect(fs.existsSync(savePaths.progressFile)).toBe(false);
    } finally {
      await first.close();
    }
    const restarted = start();
    try {
      expect((await restarted.inject({ url: '/api/saves' })).json()).toMatchObject({ activeId: null, saves: [] });
      expect((await restarted.inject({ method: 'POST', url: '/api/game', payload: { mode: 'ranked', saveId: null } })).json().error).toContain('建立');
    } finally {
      await restarted.close();
    }
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
    expect(body.end.level).toBeLessThan(body.start.level);
    expect(body.timeline.every((g: { deltaR: number }) => g.deltaR > 0)).toBe(true);
    const after = (await app.inject({ method: 'GET', url: '/api/progress' })).json();
    expect(after.level).toBe(before.level);
    expect(after.gamesTotal).toBe(before.gamesTotal);
  });

  it('摆子建局：格子里有黑白，分析前不需要引擎', async () => {
    const grid = new Array(81).fill(0);
    grid[idx(9, 2, 2)] = 1;
    grid[idx(9, 2, 3)] = 1;
    grid[idx(9, 6, 6)] = 2;
    const res = await app.inject({ method: 'POST', url: '/api/game/setup', payload: { size: 9, grid, toPlay: 'B' } });
    expect(res.statusCode).toBe(200);
    const snap = res.json().snapshot;
    expect(snap.size).toBe(9);
    expect(snap.grid.filter((c: number) => c !== 0).length).toBe(3);
    expect(snap.playerColor).toBe('B');
  });

  it('摆子建局会拒绝残缺盘面', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/game/setup', payload: { size: 9, grid: [0, 1] } });
    expect(res.statusCode).toBe(400);
  });

  it('悔棋之后能重做，重做栈空了再重做报错', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 2 },
    });
    const id = created.json().snapshot.id as string;
    // 同机对手（human）不会自动应手，方便断言
    const setup = await app.inject({
      method: 'POST',
      url: '/api/game/setup',
      payload: { size: 9, grid: new Array(81).fill(0), toPlay: 'B' },
    });
    const sid = setup.json().snapshot.id as string;
    await app.inject({ method: 'POST', url: `/api/game/${sid}/move`, payload: { vertex: idx(9, 4, 4) } });
    const undone = await app.inject({ method: 'POST', url: `/api/game/${sid}/undo`, payload: {} });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().snapshot.canRedo).toBe(true);
    const redone = await app.inject({ method: 'POST', url: `/api/game/${sid}/redo` });
    expect(redone.statusCode).toBe(200);
    expect(redone.json().snapshot.moves.length).toBe(1);
    const again = await app.inject({ method: 'POST', url: `/api/game/${sid}/redo` });
    expect(again.statusCode).toBe(400);
    void id;
  });

  it('没有着手时复盘给出中文原因', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, playerColor: 'B', level: 2 },
    });
    const id = created.json().snapshot.id as string;
    const res = await app.inject({ method: 'POST', url: `/api/game/${id}/review` });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
    expect(String(res.json().reason)).toMatch(/引擎|着手|复盘/);
  });

  it('手谈：创建/加入/观战/落子/悔棋征得同意/认输', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/room', payload: { size: 9, name: '房主', clientId: 'a'.repeat(32) } });
    expect(created.statusCode).toBe(200);
    const code = created.json().room.code as string;
    expect(created.json().room.status).toBe('waiting');
    expect(created.json().color).toBe('B');

    const joined = await app.inject({ method: 'POST', url: `/api/room/${code}/join`, payload: { name: '棋友', clientId: 'b'.repeat(32) } });
    expect(joined.json().color).toBe('W');
    expect(joined.json().room.status).toBe('playing');

    const spec = await app.inject({ method: 'POST', url: `/api/room/${code}/join`, payload: { name: '观众', clientId: 'c'.repeat(32) } });
    expect(spec.json().color).toBe('spectator');
    expect(spec.json().room.spectators).toBe(1);

    // 观众不能落子
    const bad = await app.inject({
      method: 'POST',
      url: `/api/room/${code}/action`,
      payload: { clientId: 'c'.repeat(32), action: 'move', vertex: idx(9, 4, 4) },
    });
    expect(bad.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: `/api/room/${code}/action`, payload: { clientId: 'a'.repeat(32), action: 'move', vertex: idx(9, 4, 4) } });
    const w = await app.inject({ method: 'POST', url: `/api/room/${code}/action`, payload: { clientId: 'b'.repeat(32), action: 'move', vertex: idx(9, 3, 3) } });
    expect(w.json().room.moves.length).toBe(2);

    const reqUndo = await app.inject({ method: 'POST', url: `/api/room/${code}/action`, payload: { clientId: 'a'.repeat(32), action: 'undo' } });
    expect(reqUndo.json().room.undoRequest).toEqual({ by: 'B' });
    const denied = await app.inject({ method: 'POST', url: `/api/room/${code}/action`, payload: { clientId: 'a'.repeat(32), action: 'undo-yes' } });
    expect(denied.statusCode).toBe(400);
    const accepted = await app.inject({ method: 'POST', url: `/api/room/${code}/action`, payload: { clientId: 'b'.repeat(32), action: 'undo-yes' } });
    expect(accepted.json().room.moves.length).toBe(1);

    const chat = await app.inject({ method: 'POST', url: `/api/room/${code}/chat`, payload: { clientId: 'c'.repeat(32), text: '加油' } });
    expect(chat.json().chat.at(-1).text).toBe('加油');

    const resign = await app.inject({ method: 'POST', url: `/api/room/${code}/action`, payload: { clientId: 'b'.repeat(32), action: 'resign' } });
    expect(resign.json().room.status).toBe('finished');
    expect(String(resign.json().room.result)).toContain('认输');
  });

  it('手谈：房间码不存在给 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/room/ZZZZZZ' });
    expect(res.statusCode).toBe(404);
  });

  it('让子局：黑先摆子、白先走、贴 0.5 目', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/game',
      payload: { mode: 'free', size: 9, handicap: 4, playerColor: 'W', timeControl: null },
    });
    expect(res.statusCode).toBe(200);
    const snap = res.json().snapshot;
    expect(snap.handicap).toBe(4);
    expect(snap.grid.filter((c: number) => c === 1).length).toBe(4);
    expect(snap.grid.filter((c: number) => c === 2).length).toBe(0);
    expect(snap.toPlay).toBe('W');
    expect(snap.komi).toBe(0.5);
    expect(snap.clock).toBeNull();
    // 白先走的第一手要能下
    const move = await app.inject({ method: 'POST', url: `/api/game/${snap.id}/move`, payload: { vertex: idx(9, 4, 4) } });
    expect(move.statusCode).toBe(200);
    expect(move.json().snapshot.moves[0].color).toBe('W');
  });

  it('不传时间制时默认 10 分 + 3×30 秒，快照里有计时', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/game', payload: { mode: 'free', size: 9 } });
    const snap = res.json().snapshot;
    expect(snap.clock).toBeTruthy();
    expect(snap.clock.control).toEqual({ mainSec: 600, byoYomiSec: 30, periods: 3 });
    expect(snap.clock.periods).toEqual({ B: 3, W: 3 });
    expect(snap.clock.running).toBe('B');
  });

  it('/api/net 返回局域网地址数组（二维码要用）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/net' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().addresses)).toBe(true);
  });

  it('修改名字写进进度', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/progress/name', payload: { name: '大帅' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().playerName).toBe('大帅');
  });
});
