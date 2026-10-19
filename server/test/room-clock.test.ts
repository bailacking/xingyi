import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineManager } from '@xingyi/engine';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { GameService } from '../src/gameService.js';
import { dataPaths } from '../src/paths.js';
import { Room, normalizeHandicap } from '../src/room.js';

const idx = (size: number, x: number, y: number): number => y * size + x;

/**
 * W2：手谈房间的棋钟。
 * 语义必须与 server/src/clock.ts 一致（读秒每手重置、超期扣一期、期数用完判负），
 * 这里用假时钟逐秒推进，不 sleep。
 */
describe('房间棋钟（复用 clock.ts 语义）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const seated = (room: Room): Room => {
    room.seat('a', '甲');
    room.seat('b', '乙');
    return room;
  };

  it('不限时房间没有钟，快照的 clock 为 null', () => {
    const room = new Room('AAA111', 9, 7.5, null);
    seated(room);
    expect(room.clock).toBeNull();
    expect(room.snapshot().clock).toBeNull();
  });

  it('只坐了一个人时表是停的，两人到齐才开始走', () => {
    const room = new Room('AAA112', 9, 7.5, { mainSec: 60, byoYomiSec: 30, periods: 3 });
    room.seat('a', '甲');
    vi.advanceTimersByTime(5000);
    expect(room.snapshot().clock?.running).toBeNull();
    expect(room.snapshot().clock?.blackMs).toBe(60000); // 等人期间不扣时间

    room.seat('b', '乙');
    expect(room.status).toBe('playing');
    expect(room.snapshot().clock?.running).toBe('B');
  });

  it('包干：主时间走完直接判负，写入 reason=timeout 并转 finished', () => {
    const room = new Room('AAA113', 9, 7.5, { mainSec: 3, byoYomiSec: 0, periods: 0 });
    seated(room);
    vi.advanceTimersByTime(3100);
    const snap = room.snapshot();
    expect(snap.status).toBe('finished');
    expect(snap.resultReason).toBe('timeout');
    expect(snap.result).toBe('黑超时，白胜');
    expect(snap.clock?.running).toBeNull();
    expect(snap.clock?.blackMs).toBe(0);

    // 判负之后再落子会被拒
    expect(() => room.play('a', idx(9, 4, 4))).toThrow(/已经结束/);
  });

  it('落子换表；读秒每手重置为满额', () => {
    const room = new Room('AAA114', 9, 7.5, { mainSec: 0, byoYomiSec: 10, periods: 3 });
    seated(room);
    vi.advanceTimersByTime(2000); // 主时间 0 → 进读秒，超出的 2 秒从本期扣
    let view = room.snapshot().clock!;
    expect(view.inByoYomi.B).toBe(true);
    expect(view.periods.B).toBe(3);
    expect(view.blackMs).toBe(8000);

    room.play('a', idx(9, 4, 4)); // 黑落子 → 换白
    expect(room.snapshot().clock?.running).toBe('W');

    room.play('b', idx(9, 4, 5)); // 白落子 → 换回黑，黑按满额读秒
    view = room.snapshot().clock!;
    expect(view.running).toBe('B');
    expect(view.blackMs).toBe(10000);
  });

  it('读秒超期一期一期扣，扣完判负', () => {
    const room = new Room('AAA116', 9, 7.5, { mainSec: 0, byoYomiSec: 10, periods: 1 });
    seated(room);
    vi.advanceTimersByTime(11000); // 超 1 秒 → 用掉唯一一期
    let view = room.snapshot().clock!;
    expect(view.periods.B).toBe(0);
    expect(view.blackMs).toBe(9000);
    expect(room.status).toBe('playing');

    vi.advanceTimersByTime(10000); // 这一期也走完 → 黑超时
    expect(room.snapshot().status).toBe('finished');
    expect(room.snapshot().resultReason).toBe('timeout');
    expect(room.snapshot().result).toContain('黑超时');
  });

  it('悔棋同意后把表交给该走的一方', () => {
    const room = new Room('AAA117', 9, 7.5, { mainSec: 60, byoYomiSec: 30, periods: 3 });
    seated(room);
    room.play('a', idx(9, 4, 4)); // 黑 → 轮到白
    room.play('b', idx(9, 4, 5)); // 白 → 轮到黑
    expect(room.snapshot().clock?.running).toBe('B');

    room.requestUndo('a');
    room.answerUndo('b', true); // 白同意 → 撤掉白那一手，又轮到白
    expect(room.snapshot().moves.length).toBe(1);
    expect(room.snapshot().toPlay).toBe('W');
    expect(room.snapshot().clock?.running).toBe('W');
  });

  it('3 分钟没人动仍然判负，且与棋钟互不影响', () => {
    const room = new Room('AAA118', 9, 7.5, null);
    seated(room);
    vi.advanceTimersByTime(3 * 60 * 1000 + 1000);
    const snap = room.snapshot();
    expect(snap.status).toBe('finished');
    expect(snap.result).toContain('3 分钟');
    expect(snap.clock).toBeNull();
  });
});

describe('房间设置：房主在等人阶段改时间制 / 让子', () => {
  it('建让子房：黑子摆好、白先走、贴 0.5 目', () => {
    const room = new Room('BBB201', 9, 7.5, null, 4);
    const snap = room.snapshot();
    expect(snap.handicap).toBe(4);
    expect(snap.komi).toBe(0.5);
    expect(snap.toPlay).toBe('W'); // 规则层判的先后手，不在 Room 里硬写
    expect(snap.moves.length).toBe(0);
    expect(snap.grid.filter((v) => v === 1).length).toBe(4);
  });

  it('房主改时间制 + 让子：盘面重摆、贴目跟着变、开下后走白的表', () => {
    const room = new Room('BBB202', 9, 7.5, null, 0);
    room.seat('host', '房主');

    room.updateSettings('host', { timeControl: { mainSec: 180, byoYomiSec: 0, periods: 0 }, handicap: 3 });
    let snap = room.snapshot();
    expect(snap.clock?.control).toEqual({ mainSec: 180, byoYomiSec: 0, periods: 0 });
    expect(snap.handicap).toBe(3);
    expect(snap.komi).toBe(0.5);
    expect(snap.grid.filter((v) => v === 1).length).toBe(3);
    expect(snap.toPlay).toBe('W');
    expect(snap.clock?.running).toBeNull(); // 还没人入座，表停着

    room.seat('guest', '棋友'); // 到齐 → playing
    snap = room.snapshot();
    expect(snap.status).toBe('playing');
    expect(snap.clock?.running).toBe('W'); // 让子局白先，走白的表

    // 开下之后锁死：房主也改不了
    expect(() => room.updateSettings('host', { handicap: 0 })).toThrow(/已经开局/);
    expect(room.snapshot().handicap).toBe(3);
  });

  it('非房主改不了；未入座的路人也是 403', () => {
    const room = new Room('BBB203', 9, 7.5, null, 0);
    room.seat('host', '房主');
    expect(() => room.updateSettings('stranger', { handicap: 2 })).toThrow(/只有房主/);

    room.seat('guest', '棋友');
    expect(() => room.updateSettings('guest', { handicap: 2 })).toThrow(/只有房主/);
  });

  it('让子数归一：1 子 = 不让，超过 9 按 9，乱给按 0', () => {
    expect(normalizeHandicap(1)).toBe(0);
    expect(normalizeHandicap(0)).toBe(0);
    expect(normalizeHandicap(12)).toBe(9);
    expect(normalizeHandicap('abc')).toBe(0);
    expect(normalizeHandicap(2.4)).toBe(2);
  });

  it('不改任何字段时是空操作（不重置棋钟）', () => {
    const room = new Room('BBB204', 9, 7.5, { mainSec: 60, byoYomiSec: 30, periods: 3 }, 0);
    room.seat('host', '房主');
    const before = room.snapshot().clock;
    room.updateSettings('host', {});
    expect(room.snapshot().clock).toEqual(before);
  });
});

describe('房间 API 的时间制', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-room-clock-'));
  const paths = dataPaths(dir);
  const service = new GameService(paths, new EngineManager(loadConfig(paths.configFile).engine));
  const app = createApp(service);

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('创建房间带 timeControl：3 分包干', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/room',
      payload: { size: 9, name: '房主', clientId: 'a', timeControl: { mainSec: 180, byoYomiSec: 0, periods: 0 } },
    });
    expect(res.statusCode).toBe(200);
    const room = res.json().room;
    expect(room.clock.control).toEqual({ mainSec: 180, byoYomiSec: 0, periods: 0 });
    expect(room.clock.blackMs).toBe(180000);
    expect(room.clock.running).toBeNull(); // 还没对手，表停着

    const joined = await app.inject({
      method: 'POST',
      url: `/api/room/${room.code}/join`,
      payload: { name: '棋友', clientId: 'b' },
    });
    expect(joined.json().room.status).toBe('playing');
    expect(joined.json().room.clock.running).toBe('B');

    const snap = await app.inject({ method: 'GET', url: `/api/room/${room.code}` });
    expect(snap.json().room.clock.control.mainSec).toBe(180);
  });

  it('timeControl: null 是不限时；不传走服务端默认（10 分 + 3×30 秒）', async () => {
    const none = await app.inject({
      method: 'POST',
      url: '/api/room',
      payload: { size: 9, clientId: 'x', timeControl: null },
    });
    expect(none.json().room.clock).toBeNull();

    const def = await app.inject({ method: 'POST', url: '/api/room', payload: { size: 9, clientId: 'y' } });
    expect(def.json().room.clock.control).toEqual({ mainSec: 600, byoYomiSec: 30, periods: 3 });
  });

  it('建房带让子；房主在等人阶段改设置；开局后 400、非房主 403', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/room',
      payload: { size: 9, clientId: 'host', name: '房主', handicap: 4, timeControl: null },
    });
    const code = created.json().room.code;
    expect(created.json().room.handicap).toBe(4);
    expect(created.json().room.komi).toBe(0.5);
    expect(created.json().room.toPlay).toBe('W');
    expect((created.json().room.grid as number[]).filter((v) => v === 1).length).toBe(4);

    // 房主改：让子 0 + 5 分的钟
    const changed = await app.inject({
      method: 'POST',
      url: `/api/room/${code}/settings`,
      payload: { clientId: 'host', timeControl: { mainSec: 300, byoYomiSec: 30, periods: 3 }, handicap: 0 },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().room.handicap).toBe(0);
    expect(changed.json().room.komi).toBe(7.5);
    expect(changed.json().room.clock.control.mainSec).toBe(300);

    // 路人不能改
    const stranger = await app.inject({
      method: 'POST',
      url: `/api/room/${code}/settings`,
      payload: { clientId: 'stranger', handicap: 2 },
    });
    expect(stranger.statusCode).toBe(403);

    // 什么都不给 → 400
    const empty = await app.inject({
      method: 'POST',
      url: `/api/room/${code}/settings`,
      payload: { clientId: 'host' },
    });
    expect(empty.statusCode).toBe(400);

    // 对手入座后开局 → 房主也改不了
    await app.inject({ method: 'POST', url: `/api/room/${code}/join`, payload: { clientId: 'guest', name: '棋友' } });
    const late = await app.inject({
      method: 'POST',
      url: `/api/room/${code}/settings`,
      payload: { clientId: 'host', handicap: 2 },
    });
    expect(late.statusCode).toBe(400);
    expect(late.json().error).toContain('已经开局');
  });
});
