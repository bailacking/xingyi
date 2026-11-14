import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { REPO_ROOT } from './paths.js';
import { GameService, ServiceError } from './gameService.js';
import { registerRoutes } from './api.js';
import { isLanPeer, isLocalRequest, isSameSiteRequest } from './networkAccess.js';

const lanRoutes = new Set([
  'GET /api/lan', 'GET /api/net', 'GET /api/room/discover', 'GET /api/room/:code',
  'POST /api/room', 'POST /api/room/:code/join', 'POST /api/room/:code/action',
  'POST /api/room/:code/chat', 'POST /api/room/:code/settings',
]);

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
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024, requestTimeout: 15_000 });

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
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!isLanPeer(req.ip) || !isSameSiteRequest(req.headers)) {
      return reply.code(403).send({ error: '请从星弈的本机或局域网地址打开页面' });
    }
    const route = req.routeOptions.url;
    if (route?.startsWith('/api/') && !lanRoutes.has(`${req.method} ${route}`) && !isLocalRequest(req.ip, req.headers)) {
      return reply.code(403).send({ error: '该功能仅限主机本机使用' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ServiceError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      reply.code(400).send({ error: '请求的数据格式有误' });
      return;
    }
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    const status = statusCode && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    reply.code(status).send({ error: status === 413 ? '请求的数据太大' : '服务器无法处理这个请求' });
  });

  registerRoutes(app, service);

  // 生产模式：直接托管 web/dist（开发时用 Vite）
  const webDist = path.join(REPO_ROOT, 'web', 'dist');
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api')) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    const urlPath = req.url.split('?')[0];
    if (urlPath !== '/' && !/^\/assets\/[\w.-]+$/.test(urlPath ?? '')) {
      return reply.code(404).send({ error: '页面不存在' });
    }
    const file = path.join(webDist, urlPath === '/' ? 'index.html' : urlPath!);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat?.isFile() && fs.realpathSync(file).startsWith(`${fs.realpathSync(webDist)}${path.sep}`)) {
      return reply.type(MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream').send(fs.createReadStream(file));
    }
    if (urlPath !== '/') return reply.code(404).send({ error: '资源不存在' });
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
