import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { REPO_ROOT } from './paths.js';
import { GameService, ServiceError } from './gameService.js';
import { registerRoutes } from './api.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

/** 组装 HTTP 应用（不 listen），方便测试用 app.inject()。 */
export function createApp(service: GameService): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

  // 允许「声明了 application/json 但 body 为空」的请求（pass / resign / end 这类无参 POST 很常见），
  // 否则 Fastify 会直接 400：Body cannot be empty when content-type is set to 'application/json'
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'content-type');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') reply.code(204).send();
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ServiceError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    reply.code(500).send({ error: `服务器出错：${message}` });
  });

  registerRoutes(app, service);

  // 生产模式：直接托管 web/dist（开发时用 Vite）
  const webDist = path.join(REPO_ROOT, 'web', 'dist');
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api')) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    const urlPath = decodeURIComponent(req.url.split('?')[0] ?? '/');
    const target = path.join(webDist, urlPath);
    const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(webDist, 'index.html');
    if (file.startsWith(webDist) && fs.existsSync(file)) {
      reply.header('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      reply.send(fs.readFileSync(file));
      return;
    }
    reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html><meta charset="utf-8"><title>星弈</title>
         <body style="font-family:system-ui;padding:40px;line-height:1.8">
         <h2>星弈服务已启动</h2>
         <p>前端还没构建。开发时请另开终端跑 <code>npm run dev</code>，访问 http://localhost:5173 。</p>
         </body>`,
      );
  });

  return app;
}
