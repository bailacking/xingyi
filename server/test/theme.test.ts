/**
 * 主题包（W4）测试：白名单 / 恶意包 / 导出→再导入 保真。
 *
 * 这组用例守三条硬约束：
 * 1. 包里出现 js / css 一律拒绝（不执行、不落盘）；
 * 2. token 只认白名单，非法值 400，缺字段补默认、多余字段只提示；
 * 3. 导出的 zip 重新导入后 tokens 与图片字节完全一致。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineManager } from '@xingyi/engine';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { GameService } from '../src/gameService.js';
import { REPO_ROOT, dataPaths } from '../src/paths.js';
import { ThemePackStore, readZip, writeZip } from '../src/themePack.js';
import type { ThemeTokens } from '@xingyi/shared';
import { SKINS } from '../../web/src/theme/skins';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-theme-'));
const paths = dataPaths(dir);
const service = new GameService(paths, new EngineManager(loadConfig(paths.configFile).engine));
const app = createApp(service);

/** 1x1 透明 PNG（真正解码得出来的最小 png） */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** WCAG 相对亮度 / 对比度（只给内置主题的底线断言用） */
function channel(v: number): number {
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(n.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function packZip(theme: unknown, assets: { name: string; data: Buffer }[] = []): Buffer {
  return writeZip([
    { name: 'theme.json', data: Buffer.from(JSON.stringify(theme), 'utf8') },
    ...assets.map((a) => ({ name: `assets/${a.name}`, data: a.data })),
  ]);
}

function upload(zip: Buffer) {
  return app.inject({
    method: 'POST',
    url: '/api/theme/import',
    headers: { 'content-type': 'application/zip' },
    payload: zip,
  });
}

/** 一个字段齐全、合法的第三方主题 */
function validTheme(id = 'ink-wash'): Record<string, unknown> {
  return {
    id,
    name: '水墨',
    author: '大帅',
    version: '1.0.0',
    description: '只测导入导出。',
    tokens: {
      color: {
        bg: '#FAFAF7',
        surface: '#FFFFFF',
        surfaceAlt: '#F0F0EB',
        primary: '#2B2B2B',
        accent: '#7A7A72',
        text: '#1A1A1A',
        textDim: '#6A6A62',
        line: '#DDDDD5',
        board: '#E8E2D4',
        boardEdge: '#C9C2B2',
        boardLine: '#333333',
        blackStone: '#101010',
        whiteStone: '#FCFCFA',
        blackStoneHighlight: '#6B655C',
        blackStoneEdge: '#050404',
        whiteStoneHighlight: '#FFFFFF',
        whiteStoneEdge: '#DCD6C8',
        seal: '#A03A2A',
        sealText: '#FFFFFF',
        danger: '#B4432F',
        ok: '#4E7A52',
      },
      radius: { sm: 3, md: 5, lg: 8 },
      shadow: 1,
      density: 'compact',
      motion: { speed: 180, bounce: false },
      font: { title: 'serif', body: 'system-ui' },
      decor: ['glow'],
      playerMark: 'seal',
    },
    variants: { button: 'soft', panel: 'solid', playerMark: 'seal', result: 'card' },
  };
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('内置主题', () => {
  const builtinIds = ['suxue', 'xuanmo', 'qingzhu', 'yinxing'];

  it('data/themes 里的内置 JSON 与前端 skins.ts 完全一致（防两份漂移）', () => {
    const store = new ThemePackStore(path.join(REPO_ROOT, 'data', 'themes'));
    const list = store.list();
    expect(list.map((t) => t.id).filter((id) => builtinIds.includes(id)).sort()).toEqual([...builtinIds].sort());

    for (const id of builtinIds) {
      const record = list.find((t) => t.id === id)!;
      const skin = SKINS.find((s) => s.id === id)!;
      expect(record.builtin).toBe(true);
      expect(record.tokens, `${id} 的 tokens 与 skins.ts 不一致`).toEqual(skin.tokens);
      expect(record.variants, `${id} 的 variants 与 skins.ts 不一致`).toEqual(skin.variants);
    }
  });

  it('四套内置主题齐全，浅深各有一个默认，底色互不相同', () => {
    expect(SKINS.filter((s) => s.builtin).map((s) => s.id)).toEqual(builtinIds);
    expect(SKINS[0]!.id).toBe('suxue'); // 默认浅色
    const xuanmo = SKINS.find((s) => s.id === 'xuanmo')!;
    expect(xuanmo.name).toBe('玄墨');
    // 玄墨是深色：底色亮度必须明显低于素雪
    expect(luminance(xuanmo.tokens.color.bg)).toBeLessThan(0.1);
    expect(luminance(SKINS[0]!.tokens.color.bg)).toBeGreaterThan(0.8);

    const bgs = SKINS.filter((s) => s.builtin).map((s) => s.tokens.color.bg);
    expect(new Set(bgs).size).toBe(bgs.length);
  });

  it('四套内置主题都过对比度底线（正文 / 次文字 / 强调 / 印章 / 棋盘线 / 黑子高光）', () => {
    for (const s of SKINS.filter((x) => x.builtin)) {
      const c = s.tokens.color;
      expect(contrast(c.text, c.bg), `${s.name} 正文`).toBeGreaterThanOrEqual(7);
      expect(contrast(c.textDim, c.bg), `${s.name} 次文字`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.accent, c.surface), `${s.name} 强调色`).toBeGreaterThanOrEqual(3);
      expect(contrast(c.sealText, c.seal), `${s.name} 印章`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.boardLine, c.board), `${s.name} 棋盘线`).toBeGreaterThanOrEqual(3);
      // 深色主题全靠这条把黑子从深色盘里拎出来，掉了就等于看不见棋
      expect(contrast(c.blackStoneHighlight, c.board), `${s.name} 黑子高光`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('主题列表 API', () => {
  it('GET /api/theme 返回数组；刚建的空目录里没有主题', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/theme' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().themes)).toBe(true);
    expect(res.json().themes.length).toBe(0);
  });
});

describe('导入：合法包', () => {
  it('合法包能导入，并出现在列表里', async () => {
    const res = await upload(packZip(validTheme(), [{ name: 'board.png', data: PNG }]));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.theme.id).toBe('ink-wash');
    expect(body.theme.builtin).toBe(false);
    expect(body.theme.assets).toHaveLength(1);
    expect(body.warnings).toEqual([]);

    const list = await app.inject({ method: 'GET', url: '/api/theme' });
    expect(list.json().themes.map((t: { id: string }) => t.id)).toContain('ink-wash');
  });

  it('缺字段用默认值补齐，多余字段忽略并提示', async () => {
    const partial = {
      id: 'partial',
      name: '残缺主题',
      tokens: { color: { bg: '#111111' }, hover: { color: '#fff' } },
      variants: { button: 'glow', weird: 'x' },
      css: 'body{display:none}',
      somethingNew: 42,
    };
    const res = await upload(packZip(partial));
    expect(res.statusCode).toBe(200);
    const { theme, warnings } = res.json();
    expect(theme.tokens.color.bg).toBe('#111111');
    // 没写的字段取默认值（胡桃木）
    expect(theme.tokens.color.board).toBe('#E3DCCB');
    expect(theme.tokens.radius.md).toBe(5);
    expect(theme.tokens.motion.speed).toBe(160);
    expect(theme.variants.button).toBe('glow');
    expect(theme.variants.result).toBe('plain');
    // 多余字段只提示
    expect(warnings.join('\n')).toContain('css');
    expect(warnings.join('\n')).toContain('somethingNew');
    // 关键：css 字段绝不能被写进磁盘当样式用
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'themes', 'partial', 'theme.json'), 'utf8'));
    expect(stored.css).toBeUndefined();
  });

  it('zip 里多包一层目录（资源管理器压缩）也能导入', async () => {
    const zip = writeZip([
      { name: 'my-theme/theme.json', data: Buffer.from(JSON.stringify(validTheme('wrapped'))) },
      { name: 'my-theme/assets/stone.png', data: PNG },
    ]);
    const res = await upload(zip);
    expect(res.statusCode).toBe(200);
    expect(res.json().theme.id).toBe('wrapped');
    expect(res.json().theme.assets).toHaveLength(1);
  });

  it('theme.json 带 UTF-8 BOM 也能导入（记事本/PowerShell 5.1 存的）', async () => {
    const zip = writeZip([
      { name: 'theme.json', data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(validTheme('bom-pack')))]) },
    ]);
    const res = await upload(zip);
    expect(res.statusCode).toBe(200);
    expect(res.json().theme.id).toBe('bom-pack');
  });

  it('上一版的主题包（没有棋子四个停点）导入后自动补默认值', async () => {
    const legacy = validTheme('legacy-pack');
    const color = (legacy.tokens as { color: Record<string, string> }).color;
    delete color.blackStoneHighlight;
    delete color.blackStoneEdge;
    delete color.whiteStoneHighlight;
    delete color.whiteStoneEdge;

    const res = await upload(packZip(legacy));
    expect(res.statusCode).toBe(200);
    const tokens = res.json().theme.tokens as ThemeTokens;
    expect(tokens.color.blackStoneHighlight).toBe('#6A6259');
    expect(tokens.color.whiteStoneEdge).toBe('#D8D2C6');
  });

  it('主题里的图片能通过资产路由取回（字节一致）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/theme/ink-wash/asset/board.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.from(res.rawPayload).equals(PNG)).toBe(true);
  });
});

describe('导入：恶意包', () => {
  it('带 .js 的包被拒（中文原因）', async () => {
    const zip = writeZip([
      { name: 'theme.json', data: Buffer.from(JSON.stringify(validTheme('evil-js'))) },
      { name: 'assets/hack.js', data: Buffer.from('alert(1)') },
    ]);
    const res = await upload(zip);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('脚本');
    expect(fs.existsSync(path.join(dir, 'themes', 'evil-js'))).toBe(false);
  });

  it('根目录塞 style.css 也被拒', async () => {
    const zip = writeZip([
      { name: 'theme.json', data: Buffer.from(JSON.stringify(validTheme('evil-css'))) },
      { name: 'style.css', data: Buffer.from('body{display:none}') },
    ]);
    const res = await upload(zip);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('CSS');
  });

  it('伪装成图片的 .svg / .html 被拒', async () => {
    for (const name of ['assets/x.svg', 'assets/x.html', 'assets/x.exe']) {
      const zip = writeZip([
        { name: 'theme.json', data: Buffer.from(JSON.stringify(validTheme('evil-ext'))) },
        { name, data: Buffer.from('<svg onload="alert(1)"/>') },
      ]);
      const res = await upload(zip);
      expect(res.statusCode, name).toBe(400);
    }
  });

  it('超过 5 MB 被拒', async () => {
    const res = await upload(Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('5 MB');
  });

  it('zip 炸弹（声明解压 12 MB）在解压前就被拒', async () => {
    const bomb = Buffer.alloc(12 * 1024 * 1024, 0); // 压缩后只有十几 KB
    const zip = writeZip([
      { name: 'theme.json', data: Buffer.from(JSON.stringify(validTheme('bomb'))) },
      { name: 'assets/big.png', data: bomb },
    ]);
    expect(zip.length).toBeLessThan(1024 * 1024); // 确实是「小而炸」的包
    const res = await upload(zip);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('上限');
  });

  it('路径穿越（../）被拒', async () => {
    const zip = writeZip([
      { name: 'theme.json', data: Buffer.from(JSON.stringify(validTheme('traversal'))) },
      { name: 'assets/../../evil.png', data: PNG },
    ]);
    const res = await upload(zip);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('越界');
  });

  it('颜色里塞 CSS 片段被拒（不允许任何函数/分号）', async () => {
    const theme = validTheme('inject');
    (theme.tokens as { color: Record<string, string> }).color.bg = '#000; } body { display:none }';
    const res = await upload(packZip(theme));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('颜色');
  });

  it('冒用内置主题 id 被拒', async () => {
    const res = await upload(packZip(validTheme('suxue')));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('内置');
  });

  it('不是 zip / 空 body 给出中文提示', async () => {
    const bad = await upload(Buffer.from('这不是 zip'));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('zip');

    const empty = await app.inject({ method: 'POST', url: '/api/theme/import', headers: { 'content-type': 'application/zip' } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toContain('zip');
  });
});

describe('导出 → 重新导入：还原一致', () => {
  it('同一实例：导出再导入，tokens / variants / 图片字节不变', async () => {
    await upload(packZip(validTheme('round-trip'), [{ name: 'board.png', data: PNG }]));

    const exported = await app.inject({ method: 'GET', url: '/api/theme/round-trip/export' });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toBe('application/zip');

    const entries = readZip(Buffer.from(exported.rawPayload));
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['assets/board.png', 'theme.json']);
    expect(entries.find((e) => e.name === 'assets/board.png')!.data.equals(PNG)).toBe(true);

    const before = JSON.parse(entries.find((e) => e.name === 'theme.json')!.data.toString('utf8')) as {
      tokens: ThemeTokens;
      variants: unknown;
    };

    const again = await upload(Buffer.from(exported.rawPayload));
    expect(again.statusCode).toBe(200);
    const after = again.json().theme as { tokens: ThemeTokens; variants: unknown };
    expect(after.tokens).toEqual(before.tokens);
    expect(after.variants).toEqual(before.variants);
    expect(again.json().warnings.join('\n')).toContain('覆盖');
  });

  it('换一台机器：把导出的包导入空数据目录，仍然一致', async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-theme-fresh-'));
    try {
      const source = new ThemePackStore(path.join(dir, 'themes'));
      const zip = source.exportZip('round-trip').buffer;

      const target = new ThemePackStore(path.join(fresh, 'themes'));
      const { theme } = target.importZip(zip);
      expect(theme.id).toBe('round-trip');
      expect(theme.tokens).toEqual(source.get('round-trip').tokens);
      expect(theme.assets.map((a) => a.name)).toEqual(['board.png']);
      expect(fs.readFileSync(path.join(fresh, 'themes', 'round-trip', 'assets', 'board.png')).equals(PNG)).toBe(true);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('内置主题也能导出（导出的是归一化后的 JSON）', async () => {
    const store = new ThemePackStore(path.join(REPO_ROOT, 'data', 'themes'));
    const zip = store.exportZip('yinxing').buffer;
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['theme.json']);
    const json = JSON.parse(entries[0]!.data.toString('utf8')) as { builtin: boolean; id: string };
    expect(json.id).toBe('yinxing');
    expect(json.builtin).toBe(true);
  });

  it('导出不存在的主题返回 404 中文', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/theme/nope/export' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('没有这个主题');
  });
});
