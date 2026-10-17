import { EngineManager } from '@xingyi/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import { dataPaths } from './paths.js';
import { loadConfig } from './config.js';
import { GameService } from './gameService.js';
import { createApp } from './app.js';

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
      await app.listen({ port, host: '127.0.0.1' });
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

  const wss = new WebSocketServer({ server: app.server });
  const clients = new Set<WebSocket>();
  const broadcast = (payload: unknown): void => {
    const text = JSON.stringify(payload);
    for (const ws of clients) if (ws.readyState === 1) ws.send(text);
  };
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', data: { engine: service.engine.status } }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  service.on('game', (snapshot) => broadcast({ type: 'game', data: snapshot }));
  service.on('engine', (status) => broadcast({ type: 'engine', data: status }));
  service.on('progress', (progress) => broadcast({ type: 'progress', data: progress }));
  service.on('error', (err) => broadcast({ type: 'error', data: err }));

  await service.init();

  const shutdown = (): void => {
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
