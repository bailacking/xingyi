import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import os from 'node:os';
import { APP_NAME, APP_NAME_EN, APP_VERSION, BOARD_SIZES, CAPS, type Mode } from '@xingyi/shared';
import { toSgf } from './sgf.js';
import { GameService, ServiceError } from './gameService.js';
import { discoverRooms } from './discovery.js';
import { checkJoseki, getJoseki, listJoseki } from './joseki.js';
import { dataPaths, type DataPaths } from './paths.js';
import { ThemePackError, ThemePackStore } from './themePack.js';

function body<T>(req: FastifyRequest): T {
  return (req.body ?? {}) as T;
}

function snapshotOf(m: ReturnType<GameService['getMatch']>) {
  return { snapshot: m.snapshot(), settlement: m.settlement ?? null };
}

/**
 * 主题包要落在「这个 service 用的数据目录」里。
 * 测试是拿临时目录 new GameService(paths) 的，而 createApp 只拿到 service，
 * 所以按运行时字段取（不要改成 `dataPaths()`：那会把测试里的导入写进仓库的 data/）。
 */
function servicePaths(service: GameService): DataPaths {
  const p = (service as unknown as { paths?: DataPaths }).paths;
  return p ?? dataPaths();
}

/** 主题包的校验错误一律是 400/404 + 中文原因，别变成 500 */
function themeError(err: unknown): never {
  if (err instanceof ThemePackError) throw new ServiceError(err.statusCode, err.message);
  throw err;
}

export function registerRoutes(app: FastifyInstance, service: GameService): void {
  app.get('/api/health', async () => ({
    ok: true,
    name: APP_NAME,
    nameEn: APP_NAME_EN,
    version: APP_VERSION,
    engine: service.engine.status,
  }));

  app.get('/api/bootstrap', async () => ({
    version: APP_VERSION,
    config: service.getConfig(),
    engine: service.engine.status,
    progress: service.progressSummary(),
    ranks: {
      maxLevel: service.ranks.maxLevel,
      calibrated: service.ranks.calibrated,
      step: service.ranks.step ?? null,
      stepCi95: service.ranks.stepCi95 ?? null,
      note: service.ranks.note ?? null,
    },
    modes: CAPS,
    engineConfigured: service.engine.configured,
  }));

  app.put('/api/config', async (req) => ({ config: service.updateConfig(body(req)) }));

  app.post('/api/engine/probe', async () => service.probeHardware());
  app.post('/api/engine/check', async () => service.checkEngine());
  app.post('/api/engine/restart', async () => service.restartEngine());

  app.post('/api/game', async (req) => {
    const b = body<{
      mode?: Mode;
      size?: 9 | 13 | 19;
      komi?: number;
      level?: number;
      playerColor?: 'B' | 'W';
      examLevel?: number;
      handicap?: number;
      timeControl?: { mainSec: number; byoYomiSec: number; periods: number } | null;
    }>(req);
    const mode = (b.mode ?? 'free') as Mode;
    const match = service.createMatch({
      mode,
      size: b.size,
      komi: b.komi,
      level: b.level,
      playerColor: b.playerColor,
      examLevel: b.examLevel ?? null,
      handicap: b.handicap,
      timeControl: b.timeControl,
    });
    return {
      ...snapshotOf(match),
      opponent: match.opponent,
      isPlacement: match.isPlacement,
      examLevel: match.examLevel,
    };
  });

  app.post('/api/game/setup', async (req) => {
    const b = body<{ size: 9 | 13 | 19; grid: number[]; toPlay?: 'B' | 'W'; komi?: number }>(req);
    if (!BOARD_SIZES.includes(b.size)) throw new ServiceError(400, '只支持 9 / 13 / 19 路');
    if (!Array.isArray(b.grid) || b.grid.length !== b.size * b.size) {
      throw new ServiceError(400, '盘面数据不完整');
    }
    if (b.grid.some((c) => c !== 0 && c !== 1 && c !== 2)) throw new ServiceError(400, '盘面里只有黑白空三种格子');
    const match = service.createFromSetup(b.size, b.grid, b.toPlay ?? 'B', b.komi ?? 7.5);
    return { ...snapshotOf(match), opponent: match.opponent, isPlacement: false, examLevel: null };
  });

  // ---------------- 题库（P4） ----------------

  app.get('/api/tsumego', async () => ({ problems: service.listTsumego() }));

  app.get<{ Params: { id: string } }>('/api/tsumego/:id', async (req) => service.getTsumego(req.params.id));

  app.post<{ Params: { id: string } }>('/api/tsumego/:id/try', async (req) => {
    const b = body<{ vertex?: number }>(req);
    return service.tryTsumego(req.params.id, Number(b.vertex));
  });

  // ---------------- 定式（W1） ----------------

  app.get('/api/joseki', async () => ({ joseki: listJoseki() }));

  app.get<{ Params: { id: string } }>('/api/joseki/:id', async (req) => getJoseki(req.params.id));

  /** 判一手：{ step, vertex } → { correct, expected?, done, ... }；expected 是 GTP 坐标。 */
  app.post<{ Params: { id: string } }>('/api/joseki/:id/check', async (req) => {
    const b = body<{ step?: number; vertex?: number }>(req);
    return checkJoseki(req.params.id, Number(b.step), Number(b.vertex));
  });

  // ---------------- 主题包（W4） ----------------
  //
  // 只做「存 / 取 / 导出」：包内只有 theme.json 与 assets 图片，
  // 服务端不解析任何 CSS/JS（校验层直接拒绝），所以这里没有注入面。

  const themes = new ThemePackStore(servicePaths(service).themes);

  // zip 按原始字节收，不走 JSON base64（省 1/3 体积，也避开 5MB 上限附近的边界）
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.get('/api/theme', async () => ({ themes: themes.list() }));

  /** 导入主题包：body 是 zip 原始字节（content-type: application/zip） */
  app.post('/api/theme/import', async (req) => {
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) throw new ServiceError(400, '请以 application/zip 上传主题包（别用表单字段）');
    try {
      return themes.importZip(raw);
    } catch (err) {
      themeError(err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/theme/:id/export', async (req, reply: FastifyReply) => {
    try {
      const { buffer, filename } = themes.exportZip(req.params.id);
      void reply.header('content-type', 'application/zip');
      void reply.header('content-disposition', `attachment; filename="${filename}"`);
      return buffer;
    } catch (err) {
      themeError(err);
    }
  });

  /** 主题包里的图片（png/jpg/webp）；文件名走白名单，防目录穿越 */
  app.get<{ Params: { id: string; file: string } }>('/api/theme/:id/asset/:file', async (req, reply: FastifyReply) => {
    try {
      const { data, mime } = themes.readAsset(req.params.id, req.params.file);
      void reply.header('content-type', mime);
      void reply.header('cache-control', 'public, max-age=300');
      return data;
    } catch (err) {
      themeError(err);
    }
  });

  // ---------------- 手谈（联机房间） ----------------

  app.post('/api/room', async (req) => {
    const b = body<{
      size?: 9 | 13 | 19;
      komi?: number;
      name?: string;
      clientId?: string;
      /** null = 不限时；不传 = 服务端默认（10 分 + 3×30 秒） */
      timeControl?: { mainSec: number; byoYomiSec: number; periods: number } | null;
      /** 让子 2~9 */
      handicap?: number;
    }>(req);
    if (!b.clientId) throw new ServiceError(400, '缺少客户端标识');
    return service.createRoom({
      size: b.size,
      komi: b.komi,
      name: b.name,
      clientId: b.clientId,
      timeControl: b.timeControl,
      handicap: b.handicap,
    });
  });

  /** 房主在等人阶段改设置：{ clientId, timeControl?, handicap? }；开局后 400 */
  app.post<{ Params: { code: string } }>('/api/room/:code/settings', async (req) => {
    const b = body<{
      clientId?: string;
      timeControl?: { mainSec: number; byoYomiSec: number; periods: number } | null;
      handicap?: number;
    }>(req);
    if (!b.clientId) throw new ServiceError(400, '缺少客户端标识');
    if (b.timeControl === undefined && b.handicap === undefined) {
      throw new ServiceError(400, '没有要改的设置（timeControl / handicap 至少给一个）');
    }
    const room = service.updateRoomSettings(req.params.code, b.clientId, {
      timeControl: b.timeControl,
      handicap: b.handicap,
    });
    return { room: room.snapshot(), chat: room.chat };
  });

  app.get('/api/net', async () => {
    // 手谈的二维码要用局域网 IP：在电脑上打开页面时 origin 是 127.0.0.1，手机扫了等于扫自己
    const addresses: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
      }
    }
    // 排序：192.168 > 10 > 其它；排除 WSL/Docker 常用的 172.16~31 与 169.254 链路本地
    const score = (ip: string): number => {
      if (ip.startsWith('192.168.')) return 0;
      if (ip.startsWith('10.')) return 1;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 90;
      if (ip.startsWith('169.254.')) return 99;
      return 2;
    };
    addresses.sort((a, b) => score(a) - score(b));
    return { addresses };
  });

  app.get('/api/room/discover', async () => ({ rooms: await discoverRooms() }));

  app.post<{ Params: { code: string } }>('/api/room/:code/join', async (req) => {
    const b = body<{ name?: string; clientId?: string }>(req);
    if (!b.clientId) throw new ServiceError(400, '缺少客户端标识');
    return service.joinRoom(req.params.code, { name: b.name, clientId: b.clientId });
  });

  app.get<{ Params: { code: string } }>('/api/room/:code', async (req) => {
    const room = service.getRoom(req.params.code);
    return { room: room.snapshot(), chat: room.chat };
  });

  app.post<{ Params: { code: string } }>('/api/room/:code/action', async (req) => {
    const b = body<{ clientId?: string; action?: string; vertex?: number }>(req);
    const allowed = ['move', 'pass', 'resign', 'undo', 'undo-yes', 'undo-no', 'leave'] as const;
    type Action = (typeof allowed)[number];
    if (!b.action || !allowed.includes(b.action as Action)) throw new ServiceError(400, '未知操作');
    const room = service.roomAction(req.params.code, b.clientId ?? '', b.action as Action, { vertex: b.vertex });
    return { room: room.snapshot(), chat: room.chat };
  });

  app.post<{ Params: { code: string } }>('/api/room/:code/chat', async (req) => {
    const b = body<{ clientId?: string; text?: string }>(req);
    if (!b.clientId) throw new ServiceError(400, '缺少客户端标识');
    const room = service.roomChat(req.params.code, b.clientId, String(b.text ?? ''));
    return { room: room.snapshot(), chat: room.chat };
  });

  app.get('/api/matches', async () => service.listMatches());

  app.get<{ Params: { id: string } }>('/api/game/:id', async (req) => {
    const m = service.getMatch(req.params.id);
    return { ...snapshotOf(m), opponent: m.opponent, isPlacement: m.isPlacement };
  });

  app.post<{ Params: { id: string } }>('/api/game/:id/move', async (req) => {
    const b = body<{ vertex?: number }>(req);
    if (typeof b.vertex !== 'number') throw new ServiceError(400, '缺少落点 vertex');
    const m = service.humanMove(req.params.id, b.vertex);
    return snapshotOf(m);
  });

  app.post<{ Params: { id: string } }>('/api/game/:id/pass', async (req) => snapshotOf(service.pass(req.params.id)));

  app.post<{ Params: { id: string } }>('/api/game/:id/undo', async (req) => {
    const b = body<{ to?: number }>(req);
    return snapshotOf(service.undo(req.params.id, b.to));
  });

  app.post<{ Params: { id: string } }>('/api/game/:id/redo', async (req) => snapshotOf(service.redo(req.params.id)));

  app.post<{ Params: { id: string } }>('/api/game/:id/end', async (req) => snapshotOf(service.endGame(req.params.id)));

  app.post<{ Params: { id: string } }>('/api/game/:id/resign', async (req) =>
    snapshotOf(service.resign(req.params.id)),
  );

  app.post<{ Params: { id: string } }>('/api/game/:id/quit', async (req) => snapshotOf(service.quit(req.params.id)));

  app.post<{ Params: { id: string } }>('/api/game/:id/score', async (req) => {
    const b = body<{ dead?: number[] }>(req);
    return service.scorePreview(req.params.id, Array.isArray(b.dead) ? b.dead : []);
  });

  app.post<{ Params: { id: string } }>('/api/game/:id/finish', async (req) => {
    const b = body<{ dead?: number[] }>(req);
    const m = service.finishScored(req.params.id, Array.isArray(b.dead) ? b.dead : []);
    return snapshotOf(m);
  });

  app.post<{ Params: { id: string } }>('/api/game/:id/analyze', async (req) => {
    const b = body<{ depth?: 'quick' | 'standard' | 'deep'; assumeLevel?: number | null }>(req);
    return service.analyze(req.params.id, b.depth, b.assumeLevel ?? null);
  });

  app.post<{ Params: { id: string } }>('/api/game/:id/review', async (req) => service.review(req.params.id));

  // 复盘是分块算的：POST /review 每叫一次推进一块并返回进度，这个路由只负责喊停
  app.post<{ Params: { id: string } }>('/api/game/:id/review/cancel', async (req) =>
    service.cancelReview(req.params.id),
  );

  app.get<{ Params: { id: string } }>('/api/game/:id/sgf', async (req, reply: FastifyReply) => {
    const m = service.getMatch(req.params.id);
    const sgf = toSgf({
      size: m.size,
      komi: m.game.komi,
      moves: m.moveList(),
      setup: { black: m.game.setup.black, white: m.game.setup.white },
      playerBlack: m.playerColor === 'B' ? service.progress.playerName : 'KataGo',
      playerWhite: m.playerColor === 'W' ? service.progress.playerName : 'KataGo',
      result: m.result ? `${m.result.winner ?? 'B'}+${m.result.margin ?? 'R'}` : null,
    });
    void reply.header('content-type', 'application/x-go-sgf; charset=utf-8');
    return sgf;
  });

  app.post('/api/sgf/import', async (req) => {
    const b = body<{ text?: string }>(req);
    if (!b.text || typeof b.text !== 'string') throw new ServiceError(400, '请把 SGF 内容放在 text 字段');
    const { match, variations, warnings } = service.importSgf(b.text);
    return { ...snapshotOf(match), opponent: match.opponent, variations, warnings };
  });

  app.get('/api/progress', async () => service.progressSummary());

  app.get('/api/progress/export', async (_req, reply: FastifyReply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="xingyi-progress.json"');
    return service.exportProgress();
  });

  app.post('/api/simulate/ranked', async (req) => {
    const b = body<{ pattern?: 'win' | 'alternate' | 'lose'; games?: number; startLevel?: number }>(req);
    return service.simulateRanked({
      pattern: b.pattern ?? 'alternate',
      games: b.games ?? 10,
      startLevel: b.startLevel,
    });
  });
  app.post('/api/progress/name', async (req) => {
    const b = body<{ name?: string }>(req);
    service.renamePlayer(b.name ?? '');
    return service.progressSummary();
  });
  app.post('/api/progress/reset', async (req) => {
    const b = body<{ confirm?: string }>(req);
    service.resetProgress(b.confirm ?? '');
    return service.progressSummary();
  });
}
