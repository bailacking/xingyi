import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { EngineManager } from '@xingyi/engine';
import { createApp } from '../src/app.js';
import { GameService } from '../src/gameService.js';
import { dataPaths } from '../src/paths.js';

it('错题从原对局生成，重复收录只有一份，重启后仍能回练与移除', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-mistakes-'));
  const makeService = () => new GameService(dataPaths(dir), new EngineManager({}));
  const service = makeService();
  const first = createApp(service);
  const reopened = createApp(makeService());
  try {
    expect((await first.inject('/api/mistakes')).json()).toEqual([]);
    const match = service.createMatch({ mode: 'free', size: 9, timeControl: null });
    const url = `/api/mistakes/${match.id}`;
    expect((await first.inject({ method: 'PUT', url })).statusCode).toBe(400);

    for (const vertex of [0, 1, 80, 9]) expect(match.game.play(match.game.toPlay, vertex).ok).toBe(true);
    service.resign(match.id);
    const before = match.snapshot();
    const saved = await first.inject({ method: 'PUT', url });
    expect(saved.statusCode).toBe(200);
    const entry = saved.json();
    expect(entry).toMatchObject({
      gameId: match.id,
      lastPracticedAt: null,
      exercise: { kind: 'save', answer: 9, stones: [0], prefix: [{ color: 'B', vertex: 0 }, { color: 'W', vertex: 1 }] },
    });
    expect((await first.inject({ method: 'PUT', url })).json()).toEqual(entry);
    expect((await first.inject('/api/mistakes')).json()).toEqual([entry]);
    expect(match.snapshot()).toEqual(before);

    await first.close();
    expect((await reopened.inject('/api/mistakes')).json()).toEqual([entry]);
    const guest = await reopened.inject({
      url: '/api/mistakes',
      remoteAddress: '192.168.1.10',
      headers: { host: '192.168.1.10:7388', origin: 'http://192.168.1.10:7388' },
    });
    expect(guest.statusCode).toBe(403);
    const practice = (vertex: number) => reopened.inject({ method: 'PUT', url: `${url}/practice`, payload: { vertex } });
    expect((await practice(80)).statusCode).toBe(400);
    expect((await practice(-1)).statusCode).toBe(400);
    expect((await reopened.inject('/api/mistakes')).json()).toEqual([entry]);
    const practiced = await practice(9);
    expect(practiced.statusCode).toBe(200);
    expect(practiced.json().lastPracticedAt).toEqual(expect.any(String));
    expect((await reopened.inject('/api/mistakes')).json()).toEqual([practiced.json()]);
    expect((await reopened.inject({ method: 'DELETE', url })).statusCode).toBe(204);
    expect((await reopened.inject({ method: 'DELETE', url })).statusCode).toBe(204);
    expect((await practice(9)).statusCode).toBe(404);
    expect((await reopened.inject('/api/mistakes')).json()).toEqual([]);
  } finally {
    await first.close();
    await reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
