/**
 * 主题包（W4）：只允许 `theme.json` + `assets/*.png|jpg|jpeg|webp`。
 *
 * 硬约束（AGENTS.md §12 / I8）：
 * - **不执行、不注入任何 CSS/JS**。包里出现 `.js` / `.css` 一律拒绝，不会落到磁盘。
 * - token 走白名单：只认 skins.ts 里那几个键，值按类型/枚举逐项校验，非法值直接 400。
 * - 缺字段用默认值补齐；不认识的字段忽略并写进 warnings（旧版程序打开新主题不崩）。
 *
 * ZIP：不引第三方包，自己读写（只支持 method 0 store / 8 deflate，拒绝 ZIP64、
 * 加密、多卷、数据描述符之外的压缩算法）。解压用 node:zlib，带 maxOutputLength 兜底，
 * 再加上「声明大小 / 实际大小 / 文件数 / 单文件」四道闸门防 zip 炸弹。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { ThemeTokens, ThemeVariants } from '@xingyi/shared';

export class ThemePackError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'ThemePackError';
  }
}

// ---------------------------------------------------------------- 限制

/** 主题包（zip）体积上限 */
export const MAX_THEME_ZIP_BYTES = 5 * 1024 * 1024;
/** 包内文件数上限 */
export const MAX_THEME_FILES = 20;
/** 单个文件解压后上限 */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
/** 全部文件解压后总上限（zip 炸弹的主闸门） */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** theme.json 本身的上限 */
const MAX_THEME_JSON_BYTES = 256 * 1024;

export const BUILTIN_THEME_IDS = ['suxue', 'xuanmo', 'qingzhu', 'yinxing'] as const;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const STYLE_EXT = new Set(['.css', '.scss', '.less', '.styl']);
const MARKUP_EXT = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml']);

// ---------------------------------------------------------------- token 白名单

const COLOR_KEYS = [
  'bg',
  'surface',
  'surfaceAlt',
  'primary',
  'accent',
  'text',
  'textDim',
  'line',
  'board',
  'boardEdge',
  'boardLine',
  'blackStone',
  'whiteStone',
  'blackStoneHighlight',
  'blackStoneEdge',
  'whiteStoneHighlight',
  'whiteStoneEdge',
  'seal',
  'sealText',
  'danger',
  'ok',
] as const;

const RADIUS_KEYS = ['sm', 'md', 'lg'] as const;

/** 缺字段时的兜底（= 默认主题「素雪」）。不读磁盘，保证空目录也能导入。 */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  color: {
    bg: '#F5F7F8',
    surface: '#FCFDFD',
    surfaceAlt: '#E9EDF0',
    primary: '#2C3740',
    accent: '#5F7686',
    text: '#191E23',
    textDim: '#5C6873',
    line: '#D9E0E5',
    board: '#E3DCCB',
    boardEdge: '#C6BEA9',
    boardLine: '#44403A',
    blackStone: '#15181B',
    whiteStone: '#FCFDFD',
    blackStoneHighlight: '#6A6259',
    blackStoneEdge: '#050403',
    whiteStoneHighlight: '#FFFFFF',
    whiteStoneEdge: '#D8D2C6',
    seal: '#AF3E31',
    sealText: '#FFF7F4',
    danger: '#BE4A3E',
    ok: '#48775C',
  },
  radius: { sm: 3, md: 5, lg: 9 },
  shadow: 0,
  density: 'comfortable',
  motion: { speed: 160, bounce: false },
  font: {
    title: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", SimSun, serif',
    body: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  decor: [],
  playerMark: 'seal',
};

export const DEFAULT_THEME_VARIANTS: ThemeVariants = {
  button: 'flat',
  panel: 'paper',
  playerMark: 'seal',
  result: 'plain',
};

const VARIANT_ENUM = {
  button: ['flat', 'soft', 'glow'],
  panel: ['paper', 'glass', 'solid'],
  playerMark: ['seal', 'avatarCard'],
  result: ['plain', 'card'],
} as const;

const DECOR_VALUES = ['glow', 'particles'];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 只允许 #rgb / #rgba / #rrggbb / #rrggbbaa；不允许任何 CSS 函数 */
function isColor(v: unknown): v is string {
  return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}

/** 字体族字符串：允许字母/数字/中文/空格/逗号/引号/连字符，禁止括号、分号、尖括号、@、url( */
function isFontStack(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!v.trim() || v.length > 160) return false;
  if (/[(){}\[\]<>;@\\]/.test(v)) return false;
  if (/url\s*\(/i.test(v) || /javascript:/i.test(v) || /expression/i.test(v)) return false;
  return true;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function cleanText(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') throw new ThemePackError(`主题包字段 ${field} 必须是文本`);
  // 去掉控制字符，避免把不可见字符写进 HTML/日志
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) throw new ThemePackError(`主题包字段 ${field} 不能为空`);
  if (s.length > max) throw new ThemePackError(`主题包字段 ${field} 太长（上限 ${max} 字）`);
  return s;
}

function rejectKeys(obj: Obj, allowed: readonly string[], prefix: string, warnings: string[]): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) warnings.push(`已忽略不认识的字段 ${prefix}${k}`);
  }
}

// ---------------------------------------------------------------- 归一化

export interface NormalizedTheme {
  tokens: ThemeTokens;
  variants: ThemeVariants;
  warnings: string[];
}

/**
 * 按白名单把任意 JSON 归一化成 ThemeTokens：
 * 缺失 → 默认值；非法 → 抛错（不静默放行，避免把「半坏」的主题塞进界面）。
 */
export function normalizeThemeTokens(raw: unknown, warnings: string[]): ThemeTokens {
  const t: ThemeTokens = structuredClone(DEFAULT_THEME_TOKENS);
  if (raw === undefined || raw === null) {
    warnings.push('theme.json 没有 tokens，已使用默认值');
    return t;
  }
  if (!isObj(raw)) throw new ThemePackError('主题包字段 tokens 必须是对象');

  rejectKeys(raw, ['color', 'radius', 'shadow', 'density', 'motion', 'font', 'decor', 'playerMark'], 'tokens.', warnings);

  if (raw.color !== undefined) {
    if (!isObj(raw.color)) throw new ThemePackError('主题包字段 tokens.color 必须是对象');
    rejectKeys(raw.color, COLOR_KEYS, 'tokens.color.', warnings);
    for (const k of COLOR_KEYS) {
      const v = raw.color[k];
      if (v === undefined) continue;
      if (!isColor(v)) {
        throw new ThemePackError(`主题包字段 tokens.color.${k} 不是合法颜色（只允许 #rgb / #rrggbb / #rrggbbaa）`);
      }
      t.color[k] = v;
    }
  }

  if (raw.radius !== undefined) {
    if (!isObj(raw.radius)) throw new ThemePackError('主题包字段 tokens.radius 必须是对象');
    rejectKeys(raw.radius, RADIUS_KEYS, 'tokens.radius.', warnings);
    for (const k of RADIUS_KEYS) {
      const v = raw.radius[k];
      if (v === undefined) continue;
      if (!isInt(v, 0, 64)) throw new ThemePackError(`主题包字段 tokens.radius.${k} 必须是 0~64 的整数`);
      t.radius[k] = v;
    }
  }

  if (raw.shadow !== undefined) {
    if (!isInt(raw.shadow, 0, 3)) throw new ThemePackError('主题包字段 tokens.shadow 必须是 0~3 的整数');
    t.shadow = raw.shadow as ThemeTokens['shadow'];
  }

  if (raw.density !== undefined) {
    if (raw.density !== 'comfortable' && raw.density !== 'compact') {
      throw new ThemePackError('主题包字段 tokens.density 只能是 comfortable / compact');
    }
    t.density = raw.density;
  }

  if (raw.motion !== undefined) {
    if (!isObj(raw.motion)) throw new ThemePackError('主题包字段 tokens.motion 必须是对象');
    rejectKeys(raw.motion, ['speed', 'bounce'], 'tokens.motion.', warnings);
    if (raw.motion.speed !== undefined) {
      if (!isInt(raw.motion.speed, 0, 2000)) throw new ThemePackError('主题包字段 tokens.motion.speed 必须是 0~2000 的整数（毫秒）');
      t.motion.speed = raw.motion.speed;
    }
    if (raw.motion.bounce !== undefined) {
      if (typeof raw.motion.bounce !== 'boolean') throw new ThemePackError('主题包字段 tokens.motion.bounce 必须是布尔值');
      t.motion.bounce = raw.motion.bounce;
    }
  }

  if (raw.font !== undefined) {
    if (!isObj(raw.font)) throw new ThemePackError('主题包字段 tokens.font 必须是对象');
    rejectKeys(raw.font, ['title', 'body'], 'tokens.font.', warnings);
    for (const k of ['title', 'body'] as const) {
      const v = raw.font[k];
      if (v === undefined) continue;
      if (!isFontStack(v)) {
        throw new ThemePackError(`主题包字段 tokens.font.${k} 不是合法字体族（不允许括号、分号、@、url(）`);
      }
      t.font[k] = v;
    }
  }

  if (raw.decor !== undefined) {
    if (!Array.isArray(raw.decor)) throw new ThemePackError('主题包字段 tokens.decor 必须是数组');
    const decor: string[] = [];
    for (const d of raw.decor) {
      if (typeof d !== 'string' || !DECOR_VALUES.includes(d)) {
        warnings.push(`已忽略不支持的装饰层 ${String(d)}`);
        continue;
      }
      if (!decor.includes(d)) decor.push(d);
    }
    t.decor = decor;
  }

  if (raw.playerMark !== undefined) {
    if (raw.playerMark !== 'seal' && raw.playerMark !== 'avatarCard') {
      throw new ThemePackError('主题包字段 tokens.playerMark 只能是 seal / avatarCard');
    }
    t.playerMark = raw.playerMark;
  }

  return t;
}

export function normalizeThemeVariants(raw: unknown, warnings: string[]): ThemeVariants {
  const v: ThemeVariants = { ...DEFAULT_THEME_VARIANTS };
  if (raw === undefined || raw === null) return v;
  if (!isObj(raw)) throw new ThemePackError('主题包字段 variants 必须是对象');
  rejectKeys(raw, Object.keys(VARIANT_ENUM), 'variants.', warnings);
  for (const k of Object.keys(VARIANT_ENUM) as (keyof ThemeVariants)[]) {
    const value = raw[k];
    if (value === undefined) continue;
    const allowed: readonly string[] = VARIANT_ENUM[k];
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new ThemePackError(`主题包字段 variants.${k} 只能是 ${allowed.join(' / ')}`);
    }
    // 每个枚举都窄，逐个赋值避免整体断言
    if (k === 'button') v.button = value as ThemeVariants['button'];
    else if (k === 'panel') v.panel = value as ThemeVariants['panel'];
    else if (k === 'playerMark') v.playerMark = value as ThemeVariants['playerMark'];
    else v.result = value as ThemeVariants['result'];
  }
  return v;
}

// ---------------------------------------------------------------- ZIP（读）

interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocd(buf: Buffer): number {
  const minEocd = 22;
  if (buf.length < minEocd) return -1;
  // 注释最长 65535，但主题包不会带注释；扫最后 64KB 足够
  const start = Math.max(0, buf.length - (minEocd + 65535));
  for (let i = buf.length - minEocd; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function decodeName(raw: Buffer): string {
  return raw.toString('utf8');
}

/** 解析 zip（只支持 store / deflate，单一分卷）。任何越界都当坏包处理。 */
export function readZip(buf: Buffer, limits = { maxFiles: MAX_THEME_FILES, maxTotalBytes: MAX_TOTAL_BYTES }): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new ThemePackError('不是有效的 zip 文件（找不到目录区）');

  const diskNo = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const countOnDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  if (diskNo !== 0 || cdDisk !== 0 || countOnDisk !== total) {
    throw new ThemePackError('不支持分卷 zip，请压成一个文件再导入');
  }
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ThemePackError('不支持 ZIP64 格式（主题包不该这么大），请用普通 zip 重新打包');
  }
  if (cdOffset + cdSize > buf.length) throw new ThemePackError('zip 目录区越界，文件可能已损坏');
  if (total > limits.maxFiles) {
    throw new ThemePackError(`主题包最多 ${limits.maxFiles} 个文件，这个包有 ${total} 个`);
  }

  const entries: ZipEntry[] = [];
  let totalOut = 0;
  let p = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) {
      throw new ThemePackError('zip 目录区损坏，无法读取');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const nameEnd = p + 46 + nameLen;
    if (nameEnd > buf.length) throw new ThemePackError('zip 文件名越界，文件可能已损坏');
    const name = decodeName(buf.subarray(p + 46, nameEnd));
    p = nameEnd + extraLen + commentLen;

    if (flags & 0x1) throw new ThemePackError('不支持加密的 zip，请去掉密码再导入');
    if (name.endsWith('/')) continue; // 目录项

    if (uncompSize > MAX_ENTRY_BYTES) {
      throw new ThemePackError(`主题包里的 ${name} 解压后 ${(uncompSize / 1024 / 1024).toFixed(1)} MB，超过单文件上限 8 MB`);
    }
    totalOut += uncompSize;
    if (totalOut > limits.maxTotalBytes) {
      throw new ThemePackError(`主题包解压后总大小超过 ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB，已拒绝（防 zip 炸弹）`);
    }

    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOCAL_SIG) {
      throw new ThemePackError(`zip 里 ${name} 的本地头损坏`);
    }
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) throw new ThemePackError(`zip 里 ${name} 的数据越界`);

    const raw = buf.subarray(dataStart, dataEnd);
    let out: Buffer;
    if (method === 0) {
      out = Buffer.from(raw);
    } else if (method === 8) {
      try {
        out = zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch {
        throw new ThemePackError(`主题包里的 ${name} 解压失败（可能被截断，或声明大小与实际不符）`);
      }
    } else {
      throw new ThemePackError(`主题包里的 ${name} 用了不支持的压缩算法（只支持 store / deflate）`);
    }
    if (out.length > MAX_ENTRY_BYTES) throw new ThemePackError(`主题包里的 ${name} 解压后过大`);
    if (crc32(out) !== crc) throw new ThemePackError(`主题包里的 ${name} 校验失败（CRC 对不上，文件已损坏）`);

    entries.push({ name, data: out });
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- ZIP（写）

/** 固定时间戳（2020-01-01），导出结果可复现，方便测试比对 */
const DOS_DATE = 0x5021;
const DOS_TIME = 0;
const UTF8_FLAG = 0x0800;

export function writeZip(files: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CD_SIG, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(UTF8_FLAG, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += 30 + name.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// ---------------------------------------------------------------- 名字与路径

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ASSET_RE = /^[A-Za-z0-9._-]{1,64}\.(?:png|jpe?g|webp)$/i;

function extOf(name: string): string {
  return path.posix.extname(name).toLowerCase();
}

/** 把一个 zip 条目名变成安全的 posix 相对路径；越界/绝对/反斜杠一律拒绝 */
function safeEntryName(name: string): string {
  const n = name.replace(/\\/g, '/');
  if (!n || n.includes('\u0000')) throw new ThemePackError('主题包里有非法文件名');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) {
    throw new ThemePackError(`主题包里有绝对路径（${name}），已拒绝`);
  }
  const segs = n.split('/');
  for (const seg of segs) {
    if (!seg || seg === '.' || seg === '..') throw new ThemePackError(`主题包里有越界路径（${name}），已拒绝`);
  }
  return n;
}

/** 去掉 zip 里那层多余的根目录（用资源管理器「压缩到 zip」时会自带一层） */
function stripCommonRoot(entries: ZipEntry[]): ZipEntry[] {
  if (entries.length === 0) return entries;
  const firstSegs = entries.map((e) => e.name.split('/'));
  const root = firstSegs[0]![0]!;
  if (firstSegs.some((segs) => segs.length < 2 || segs[0] !== root)) return entries;
  return entries.map((e) => ({ name: e.name.slice(root.length + 1), data: e.data }));
}

function classifyEntry(name: string): 'theme-json' | 'asset' {
  if (name === 'theme.json') return 'theme-json';
  const ext = extOf(name);
  if (name.startsWith('assets/') && !name.slice('assets/'.length).includes('/') && ASSET_RE.test(name.slice('assets/'.length))) {
    return 'asset';
  }
  if (SCRIPT_EXT.has(ext)) throw new ThemePackError(`主题包不允许包含脚本文件（${name}）—— 主题不执行任何 JS`);
  if (STYLE_EXT.has(ext)) throw new ThemePackError(`主题包不允许包含 CSS 文件（${name}）—— 主题只能改 token`);
  if (MARKUP_EXT.has(ext)) throw new ThemePackError(`主题包不允许包含 ${ext} 文件（${name}）`);
  if (ext && !IMAGE_EXT.has(ext)) throw new ThemePackError(`主题包里有不允许的文件类型（${name}），只允许 theme.json 与 assets/ 下的 png/jpg/webp 图片`);
  throw new ThemePackError(`主题包结构不合法：${name} 只能放在 assets/ 下，且图片格式限 png/jpg/webp`);
}

function slugId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug && ID_RE.test(slug) ? slug : 'theme';
}

// ---------------------------------------------------------------- 存储

export interface ThemeAsset {
  name: string;
  /** 相对 URL，前端 <img src> 直接用 */
  url: string;
}

export interface ThemePackRecord {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  builtin: boolean;
  tokens: ThemeTokens;
  variants: ThemeVariants;
  assets: ThemeAsset[];
}

export interface ImportResult {
  theme: ThemePackRecord;
  warnings: string[];
}

function assetUrl(id: string, file: string): string {
  return `/api/theme/${encodeURIComponent(id)}/asset/${encodeURIComponent(file)}`;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export class ThemePackStore {
  constructor(readonly root: string) {}

  private dirOf(id: string): string {
    if (!ID_RE.test(id)) throw new ThemePackError('主题 id 只能用小写字母、数字、- 和 _', 404);
    return path.join(this.root, id);
  }

  /** 读一个主题目录；坏包不抛错，直接跳过（别让一个坏目录拖垮整个列表） */
  private readDir(id: string): ThemePackRecord | null {
    const dir = this.dirOf(id);
    const file = path.join(dir, 'theme.json');
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
    try {
      const warnings: string[] = [];
      const record = buildRecord(raw, warnings, id);
      record.assets = this.listAssets(id);
      return record;
    } catch {
      return null;
    }
  }

  private listAssets(id: string): ThemeAsset[] {
    const dir = path.join(this.dirOf(id), 'assets');
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => ASSET_RE.test(n))
      .sort()
      .map((n) => ({ name: n, url: assetUrl(id, n) }));
  }

  list(): ThemePackRecord[] {
    fs.mkdirSync(this.root, { recursive: true });
    const ids = fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ID_RE.test(d.name))
      .map((d) => d.name);

    const order = (id: string): number => {
      const i = (BUILTIN_THEME_IDS as readonly string[]).indexOf(id);
      return i < 0 ? 99 : i;
    };
    ids.sort((a, b) => order(a) - order(b) || a.localeCompare(b));

    const out: ThemePackRecord[] = [];
    for (const id of ids) {
      const r = this.readDir(id);
      if (r) out.push(r);
    }
    return out;
  }

  get(id: string): ThemePackRecord {
    const r = this.readDir(id);
    if (!r) throw new ThemePackError(`没有这个主题：${id}`, 404);
    return r;
  }

  /** 导入 zip；成功返回归一化后的主题（缺字段已补默认，多余字段在 warnings 里） */
  importZip(buf: Buffer): ImportResult {
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new ThemePackError('请上传 zip 文件');
    if (buf.length > MAX_THEME_ZIP_BYTES) {
      throw new ThemePackError(`主题包 ${(buf.length / 1024 / 1024).toFixed(1)} MB，超过 5 MB 上限`);
    }

    const entries = stripCommonRoot(readZip(buf).map((e) => ({ name: safeEntryName(e.name), data: e.data })));
    if (entries.length === 0) throw new ThemePackError('主题包是空的');

    let themeJson: Buffer | null = null;
    const assets: { name: string; data: Buffer }[] = [];
    for (const e of entries) {
      const kind = classifyEntry(e.name);
      if (kind === 'theme-json') {
        if (themeJson) throw new ThemePackError('主题包里只能有一个 theme.json');
        if (e.data.length > MAX_THEME_JSON_BYTES) throw new ThemePackError('theme.json 太大了（上限 256 KB）');
        themeJson = e.data;
      } else {
        const file = e.name.slice('assets/'.length);
        assets.push({ name: file, data: e.data });
      }
    }
    if (!themeJson) throw new ThemePackError('主题包缺少 theme.json');

    let raw: unknown;
    try {
      // 记事本 / Windows PowerShell 5.1 存 UTF-8 会带 BOM，先剥掉再解析
      const text = themeJson.toString('utf8').replace(/^\uFEFF/, '');
      raw = JSON.parse(text);
    } catch {
      throw new ThemePackError('theme.json 不是合法 JSON');
    }

    const warnings: string[] = [];
    const record = buildRecord(raw, warnings, null);
    if ((BUILTIN_THEME_IDS as readonly string[]).includes(record.id)) {
      throw new ThemePackError(`主题 id「${record.id}」是内置主题，换一个 id 再导入`);
    }

    // 落盘：先删旧目录再写，保证「重新导入同一个包」是幂等的
    const dir = this.dirOf(record.id);
    const existed = fs.existsSync(path.join(dir, 'theme.json'));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(serialize(record), null, 2), 'utf8');
    for (const a of assets) fs.writeFileSync(path.join(dir, 'assets', a.name), a.data);

    if (existed) warnings.push(`已覆盖同名主题「${record.name}」`);
    record.assets = this.listAssets(record.id);
    return { theme: record, warnings };
  }

  exportZip(id: string): { buffer: Buffer; filename: string } {
    const record = this.get(id);
    const dir = this.dirOf(id);
    const files: { name: string; data: Buffer }[] = [
      { name: 'theme.json', data: Buffer.from(JSON.stringify(serialize(record), null, 2), 'utf8') },
    ];
    for (const asset of record.assets) {
      const file = path.join(dir, 'assets', asset.name);
      if (!ASSET_RE.test(asset.name)) continue;
      try {
        files.push({ name: `assets/${asset.name}`, data: fs.readFileSync(file) });
      } catch {
        /* 文件被删了就跳过 */
      }
    }
    return { buffer: writeZip(files), filename: `${id}.zip` };
  }

  readAsset(id: string, file: string): { data: Buffer; mime: string } {
    if (!ASSET_RE.test(file)) throw new ThemePackError('资产文件名不合法', 404);
    const target = path.join(this.dirOf(id), 'assets', file);
    const root = path.resolve(this.dirOf(id), 'assets');
    if (!path.resolve(target).startsWith(root + path.sep)) throw new ThemePackError('资产路径越界', 404);
    try {
      return { data: fs.readFileSync(target), mime: MIME_BY_EXT[extOf(file)] ?? 'application/octet-stream' };
    } catch {
      throw new ThemePackError('没有这个资产文件', 404);
    }
  }
}

/** 落盘时写的形态（导出也用它，保证「导出→再导入」一致） */
function serialize(r: ThemePackRecord): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    author: r.author,
    version: r.version,
    description: r.description,
    builtin: r.builtin,
    tokens: r.tokens,
    variants: r.variants,
  };
}

function buildRecord(raw: unknown, warnings: string[], forcedId: string | null): ThemePackRecord {
  if (!isObj(raw)) throw new ThemePackError('theme.json 必须是一个 JSON 对象');

  rejectKeys(
    raw,
    ['id', 'name', 'author', 'version', 'description', 'builtin', 'tokens', 'variants', 'css'],
    '',
    warnings,
  );
  if (raw.css !== undefined) warnings.push('已忽略字段 css：主题包不允许 CSS，只能改 token');

  const name = cleanText(raw.name, 'name', 40);
  let id: string;
  if (forcedId) {
    id = forcedId;
  } else if (raw.id === undefined) {
    id = slugId(name);
    warnings.push(`theme.json 没写 id，已按名字生成「${id}」`);
  } else if (typeof raw.id === 'string' && ID_RE.test(raw.id)) {
    id = raw.id;
  } else {
    throw new ThemePackError('主题包字段 id 只能用小写字母、数字、- 和 _（最长 32 位）');
  }

  return {
    id,
    name,
    author: raw.author === undefined ? '匿名' : cleanText(raw.author, 'author', 40),
    version: raw.version === undefined ? '1.0.0' : cleanText(raw.version, 'version', 20),
    description: raw.description === undefined ? '' : cleanText(raw.description, 'description', 200),
    // 导入的主题永远不是内置；内置只由仓库里的 data/themes/<id> 决定
    builtin: forcedId !== null ? raw.builtin === true : false,
    tokens: normalizeThemeTokens(raw.tokens, warnings),
    variants: normalizeThemeVariants(raw.variants, warnings),
    assets: [],
  };
}
