import { EngineManager } from '@xingyi/engine';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { dataPaths } from './paths.js';
import { loadConfig } from './config.js';
import { GameService } from './gameService.js';
import { createApp } from './app.js';
import { startBeacon } from './discovery.js';
import { isLanPeer, isLocalRequest, isSameSiteRequest } from './networkAccess.js';

async function main(): Promise<void> {
  const paths = dataPaths();
  const cfg = loadConfig(paths.configFile);
  const engine = new EngineManager(cfg.engine);
  const service = new GameService(paths, engine);
  service.normalizeOnBoot();
  const app = createApp(service);

  const desired = Number(process.env.XINGYI_PORT ?? process.env.PORT ?? 7388);
  let port = desired;
  for (let attempt = 0; ; attempt++) {
    try {
      // 手谈要手机/平板在局域网里连进来，必须监听所有网卡
      await app.listen({ port, host: '0.0.0.0' });
      const listener = app.server.address();
      if (listener && typeof listener !== 'string') port = listener.port;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE' && attempt < 20) {
        port += 1;
        continue;
      }
      throw err;
    }
  }

  const wss = new WebSocketServer({
    server: app.server,
    maxPayload: 1024,
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const peer = req.socket.remoteAddress ?? '';
      if (!isLanPeer(peer) || !isSameSiteRequest(req.headers) || wss.clients.size >= 128) return false;
      return req.url === '/ws'
        ? isLocalRequest(peer, req.headers)
        : /^\/ws\/rooms\?room=[A-Z0-9]{6}$/.test(req.url ?? '');
    },
  });
  const clients = new Map<WebSocket, string | null>();
  const alive = new WeakSet<WebSocket>();
  const broadcast = (payload: unknown, room: string | null = null): void => {
    const text = JSON.stringify(payload);
    for (const [ws, subscription] of clients) {
      if (subscription !== room || ws.readyState !== 1) continue;
      if (ws.bufferedAmount > 1024 * 1024) ws.terminate();
      else ws.send(text);
    }
  };
  wss.on('connection', (ws, req) => {
    const room = req.url === '/ws' ? null : req.url!.slice(-6);
    clients.set(ws, room);
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    if (room === null) {
      ws.send(JSON.stringify({ type: 'hello', data: { engine: service.engine.status } }));
    } else {
      try {
        const current = service.getRoom(room);
        ws.send(JSON.stringify({ type: 'room', data: { room: current.snapshot(), chat: current.chat } }));
      } catch {
        ws.close(1008);
      }
    }
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
  const heartbeat = setInterval(() => {
    for (const ws of clients.keys()) {
      if (!alive.delete(ws)) ws.terminate();
      else ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  service.on('game', (snapshot) => broadcast({ type: 'game', data: snapshot }));
  service.on('engine', (status) => broadcast({ type: 'engine', data: status }));
  service.on('progress', (progress) => broadcast({ type: 'progress', data: progress }));
  service.on('room', (room) => {
    // 房间快照 + 聊天一起推：客户端不用再单独拉一次
    let chat: unknown[] = [];
    try {
      chat = service.getRoom(room.code).chat;
    } catch {
      chat = []; // 房间刚被删掉（最后一人离开）时取不到，推个空数组就行
    }
    broadcast({ type: 'room', data: { room, chat } }, room.code);
  });
  service.on('error', (err) => broadcast({ type: 'error', data: err }));

  await service.init();
  const stopBeacon = startBeacon(port, () => service.listRooms().filter((r) => r.status === 'waiting'));

  const shutdown = (): void => {
    stopBeacon();
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    service.dispose();
    void service.engine.stop().finally(() => void app.close().finally(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[星弈] 服务已启动：http://127.0.0.1:${port}${port !== desired ? `（${desired} 被占用，已顺延）` : ''}`);
  console.log(`[星弈] 数据目录：${paths.data}`);
  console.log(
    `[星弈] 引擎：${service.engine.configured ? '已配置，正在后台加载' : '未配置（自在模式可用离线对手试玩；修习模式需要 KataGo）'}`,
  );
}

main().catch((err) => {
  console.error('[星弈] 启动失败：', err);
  process.exit(1);
});
