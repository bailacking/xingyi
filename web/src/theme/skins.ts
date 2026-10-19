import type { ThemeTokens, ThemeVariants } from '@xingyi/shared';

const SERIF = '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", SimSun, serif';
const SANS = '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/** 胡桃木（典雅，默认）：米白宣纸 + 深胡桃木 + 细金线（AGENTS.md §12） */
export const walnut: ThemeTokens = {
  color: {
    bg: '#F7F4EE',
    surface: '#FFFDF9',
    surfaceAlt: '#F1EBE0',
    primary: '#3E2C20',
    accent: '#A98C5F',
    text: '#2A2622',
    textDim: '#6B625A',
    line: '#DCD2C2',
    board: '#E5C08A',
    boardEdge: '#C79E67',
    boardLine: '#4A3A2A',
    blackStone: '#15110E',
    whiteStone: '#FCFAF5',
    seal: '#9C3A2E',
    sealText: '#FBF7F2',
    danger: '#B4432F',
    ok: '#4E7A52',
  },
  radius: { sm: 2, md: 4, lg: 6 },
  shadow: 0,
  density: 'comfortable',
  motion: { speed: 200, bounce: false },
  font: { title: SERIF, body: SANS },
  decor: [],
  playerMark: 'seal',
};

/** 星弈·青（墨青夜）：深青底 + 金线 + 紫光（D64），同时是主题系统的压力测试 */
export const youth: ThemeTokens = {
  color: {
    bg: '#0A1517',
    surface: '#12262A',
    surfaceAlt: '#173036',
    primary: '#2C6E74',
    accent: '#D8B87A',
    text: '#E6F1EF',
    textDim: '#8FA9A6',
    line: '#1E3A3E',
    board: '#1B3F42',
    boardEdge: '#0F2729',
    boardLine: '#8FB8B3',
    blackStone: '#08100F',
    whiteStone: '#F0F7F5',
    seal: '#C8A15A',
    sealText: '#0A1517',
    danger: '#E0715B',
    ok: '#6FD3B0',
  },
  radius: { sm: 12, md: 16, lg: 24 },
  shadow: 3,
  density: 'compact',
  motion: { speed: 320, bounce: true },
  font: { title: SANS, body: SANS },
  decor: ['glow'],
  playerMark: 'seal',
};

/** 竹青（W4 新增）：竹青纸 + 墨绿，冷色低饱和，介于前两套之间——不喧哗、比胡桃木现代 */
export const bamboo: ThemeTokens = {
  color: {
    bg: '#EDF1EA',
    surface: '#F7FAF4',
    surfaceAlt: '#E2E9DE',
    primary: '#3C5648',
    accent: '#6E8B6B',
    text: '#1F2C25',
    textDim: '#5F7167',
    line: '#CBD6C8',
    board: '#E0D5B4',
    boardEdge: '#BFB08A',
    boardLine: '#3B4C42',
    blackStone: '#131C17',
    whiteStone: '#F8FAF3',
    seal: '#8A4B3E',
    sealText: '#F5F2E9',
    danger: '#9E5142',
    ok: '#557C5B',
  },
  radius: { sm: 6, md: 10, lg: 14 },
  shadow: 1,
  density: 'comfortable',
  motion: { speed: 260, bounce: false },
  font: { title: SERIF, body: SANS },
  decor: [],
  playerMark: 'seal',
};

export interface ThemeAsset {
  name: string;
  url: string;
}

/** 一套可用的主题（内置 3 套 + 导入的若干套） */
export interface Skin {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tokens: ThemeTokens;
  variants: ThemeVariants;
  /** 内置主题由仓库维护，不可被导入覆盖 */
  builtin: boolean;
  author?: string;
  version?: string;
  assets?: ThemeAsset[];
}

/**
 * 主题列表：**可变数组**。
 * App.tsx 在渲染时调 skinById()，Settings 导入后往这里 upsert，界面立即生效（不用改 App）。
 */
export const SKINS: Skin[] = [
  {
    id: 'walnut',
    name: '胡桃木',
    tagline: '典雅 · 默认',
    description: '米白宣纸底、深胡桃木、细金线。宋体、直角、几乎无动效。像一间书房。',
    tokens: walnut,
    variants: { button: 'flat', panel: 'paper', playerMark: 'seal', result: 'plain' },
    builtin: true,
    author: 'xingyi',
    version: '1.0.0',
  },
  {
    id: 'youth',
    name: '星弈·青',
    tagline: '墨青夜',
    description: '深青底、金线、柔光。黑体、大圆角、弹性动效。夜里下棋用的那一套。',
    tokens: youth,
    variants: { button: 'glow', panel: 'glass', playerMark: 'seal', result: 'card' },
    builtin: true,
    author: 'xingyi',
    version: '1.0.0',
  },
  {
    id: 'bamboo',
    name: '竹青',
    tagline: '冷色 · 低饱和',
    description: '竹青纸底、墨绿、赭石印。中圆角、极轻投影、不弹动。安静看书的那一套。',
    tokens: bamboo,
    variants: { button: 'soft', panel: 'solid', playerMark: 'seal', result: 'card' },
    builtin: true,
    author: 'xingyi',
    version: '1.0.0',
  },
];

/**
 * 导入主题的本地缓存。
 * 为什么放 localStorage：App.tsx 不在 W4 的可改范围内，它只在启动时读 localStorage 里的 themeId
 * 并立刻 skinById()。缓存让「刷新后仍记得导入的主题」在这个前提下也能成立；
 * 服务端列表随后由 packs.syncThemes() 覆盖校正。
 */
const CUSTOM_CACHE_KEY = 'xingyi.themes.custom';

/** 内置主题 + 已缓存的自定义主题里找；找不到回退第一套（胡桃木） */
export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]!;
}

/** 插入或更新一套主题；内置主题的 id 不允许被外部覆盖 */
export function upsertSkin(skin: Skin): void {
  const i = SKINS.findIndex((s) => s.id === skin.id);
  if (i < 0) {
    SKINS.push(skin);
    return;
  }
  if (SKINS[i]!.builtin) return;
  SKINS[i] = skin;
}

/** 丢掉一套非内置主题（服务端已经没有的） */
export function dropSkin(id: string): void {
  const i = SKINS.findIndex((s) => s.id === id);
  if (i >= 0 && !SKINS[i]!.builtin) SKINS.splice(i, 1);
}

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** 把非内置主题写进 localStorage（只存 token 等元信息，不存图片） */
export function persistSkins(): void {
  if (!hasStorage()) return;
  const custom = SKINS.filter((s) => !s.builtin).map((s) => ({
    id: s.id,
    name: s.name,
    tagline: s.tagline,
    description: s.description,
    tokens: s.tokens,
    variants: s.variants,
    builtin: false,
    author: s.author,
    version: s.version,
    assets: s.assets ?? [],
  }));
  try {
    localStorage.setItem(CUSTOM_CACHE_KEY, JSON.stringify(custom));
  } catch {
    /* 配额满了就放弃缓存，主题仍可用，只是刷新后要重新拉列表 */
  }
}

function hydrate(): void {
  if (!hasStorage()) return;
  try {
    const raw = localStorage.getItem(CUSTOM_CACHE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const s = item as Skin;
      if (typeof s.id !== 'string' || !s.tokens) continue;
      if (SKINS.some((x) => x.id === s.id && x.builtin)) continue;
      upsertSkin({ ...s, builtin: false });
    }
  } catch {
    /* 缓存坏了就当没有 */
  }
}

hydrate();

/** tokens → CSS 变量对象（可套在任意容器上，主题预览就靠这个） */
export function cssVars(t: ThemeTokens): Record<string, string> {
  const shadowMap = [
    'none',
    '0 1px 2px rgba(0,0,0,.10)',
    '0 4px 10px rgba(0,0,0,.14)',
    '0 10px 26px rgba(0,0,0,.22)',
  ];
  return {
    '--bg': t.color.bg,
    '--surface': t.color.surface,
    '--surface-alt': t.color.surfaceAlt,
    '--primary': t.color.primary,
    '--accent': t.color.accent,
    '--text': t.color.text,
    '--text-dim': t.color.textDim,
    '--line': t.color.line,
    '--board': t.color.board,
    '--board-edge': t.color.boardEdge,
    '--board-line': t.color.boardLine,
    '--stone-black': t.color.blackStone,
    '--stone-white': t.color.whiteStone,
    '--seal': t.color.seal,
    '--seal-text': t.color.sealText,
    '--danger': t.color.danger,
    '--ok': t.color.ok,
    '--radius-sm': `${t.radius.sm}px`,
    '--radius-md': `${t.radius.md}px`,
    '--radius-lg': `${t.radius.lg}px`,
    '--shadow': shadowMap[t.shadow] ?? 'none',
    '--motion': `${t.motion.speed}ms`,
    '--font-title': t.font.title,
    '--font-body': t.font.body,
    '--density': t.density === 'compact' ? '10px' : '16px',
  };
}
