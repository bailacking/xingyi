import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { APP_NAME, APP_NAME_EN, APP_VERSION, BOARD_SIZES, CAPS, type Mode } from '@xingyi/shared';
import { toSgf } from './sgf.js';
import { GameService, ServiceError } from './gameService.js';
import { discoverRooms } from './discovery.js';

function body<T>(req: FastifyRequest): T {
  return (req.body ?? {}) as T;
}

function snapshotOf(m: ReturnType<GameService['getMatch']>) {
  return { snapshot: m.snapshot(), settlement: m.settlement ?? null };
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
    const b = body<{ mode?: Mode; size?: 9 | 13 | 19; komi?: number; level?: number; playerColor?: 'B' | 'W'; examLevel?: number }>(req);
    const mode = (b.mode ?? 'free') as Mode;
    const match = service.createMatch({
      mode,
      size: b.size,
      komi: b.komi,
      level: b.level,
      playerColor: b.playerColor,
      examLevel: b.examLevel ?? null,
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

  // ---------------- 手谈（联机房间） ----------------

  app.post('/api/room', async (req) => {
    const b = body<{ size?: 9 | 13 | 19; komi?: number; name?: string; clientId?: string }>(req);
    if (!b.clientId) throw new ServiceError(400, '缺少客户端标识');
    return service.createRoom({ size: b.size, komi: b.komi, name: b.name, clientId: b.clientId });
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
