import type { ThemeTokens, ThemeVariants } from '@xingyi/shared';

const SERIF = '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", SimSun, serif';
const SANS = '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/** 默认主题 id（浅色）。深色不自动跟随系统，由用户在设置里切。 */
export const DEFAULT_SKIN_ID = 'suxue';

/**
 * 素雪 · 冷雪（默认浅色）
 * 冷白纸面 + 墨灰字 + 一点朱印。近乎无色相，先把内容与棋盘让出来。
 */
export const suxue: ThemeTokens = {
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
  font: { title: SERIF, body: SANS },
  decor: [],
  playerMark: 'seal',
};

/**
 * 玄墨 · 冷炭（默认深色）
 * 炭灰底 + 月光银 + 朱砂印。三层 surface 撑层级（深底上阴影几乎看不见），
 * 黑子高光提到 #9A9C9E（对盘 4.3），否则 19 路满盘会糊成一片。
 */
export const xuanmo: ThemeTokens = {
  color: {
    bg: '#15171A',
    surface: '#1D2126',
    surfaceAlt: '#252B31',
    primary: '#5D6C78',
    accent: '#8FA6B8',
    text: '#EAEEF1',
    textDim: '#9AA5AE',
    line: '#2C3339',
    board: '#33383C',
    boardEdge: '#202427',
    boardLine: '#9DA8AE',
    blackStone: '#0B0D0F',
    whiteStone: '#EFF1F2',
    blackStoneHighlight: '#9A9C9E',
    blackStoneEdge: '#000000',
    whiteStoneHighlight: '#FFFFFF',
    whiteStoneEdge: '#C9CCCE',
    seal: '#C85B45',
    sealText: '#14100E',
    danger: '#DE7660',
    ok: '#74AE92',
  },
  radius: { sm: 4, md: 6, lg: 10 },
  shadow: 2,
  density: 'comfortable',
  motion: { speed: 240, bounce: false },
  font: { title: SERIF, body: SANS },
  decor: [],
  playerMark: 'seal',
};

/** 青竹 · 新篁（浅绿）：竹青纸 + 竹叶绿 + 竹黄盘，绿而不甜 */
export const qingzhu: ThemeTokens = {
  color: {
    bg: '#EDF3E6',
    surface: '#F8FBF2',
    surfaceAlt: '#E1EAD9',
    primary: '#38543E',
    accent: '#5C8250',
    text: '#1B2A1E',
    textDim: '#566B58',
    line: '#CBD9C3',
    board: '#E2D6B0',
    boardEdge: '#C1B383',
    boardLine: '#38472F',
    blackStone: '#12180F',
    whiteStone: '#FAFCF4',
    blackStoneHighlight: '#6C6A5E',
    blackStoneEdge: '#0A0B08',
    whiteStoneHighlight: '#FFFFFF',
    whiteStoneEdge: '#D8D4C4',
    seal: '#A6472F',
    sealText: '#FFF7F2',
    danger: '#A94E38',
    ok: '#4B7D55',
  },
  radius: { sm: 6, md: 10, lg: 14 },
  shadow: 1,
  density: 'comfortable',
  motion: { speed: 220, bounce: false },
  font: { title: SERIF, body: SANS },
  decor: [],
  playerMark: 'seal',
};

/** 银杏 · 暖杏（浅黄）：奶油纸 + 银杏金 + 赭石印，四套里唯一偏暖 */
export const yinxing: ThemeTokens = {
  color: {
    bg: '#FBF6E7',
    surface: '#FFFDF4',
    surfaceAlt: '#F3EAD3',
    primary: '#4A3B15',
    accent: '#B08A24',
    text: '#2C2618',
    textDim: '#6F6242',
    line: '#E4D8B8',
    board: '#E7D8AE',
    boardEdge: '#C7B67F',
    boardLine: '#4A3F22',
    blackStone: '#1A1710',
    whiteStone: '#FFFDF5',
    blackStoneHighlight: '#6E6552',
    blackStoneEdge: '#0E0B07',
    whiteStoneHighlight: '#FFFFFF',
    whiteStoneEdge: '#DCD0B4',
    seal: '#A8442F',
    sealText: '#FFF7F1',
    danger: '#B04A33',
    ok: '#5A7B4A',
  },
  radius: { sm: 4, md: 8, lg: 12 },
  shadow: 1,
  density: 'comfortable',
  motion: { speed: 200, bounce: false },
  font: { title: SERIF, body: SANS },
  decor: [],
  playerMark: 'seal',
};

export interface ThemeAsset {
  name: string;
  url: string;
}

/** 一套可用的主题（内置 4 套 + 导入的若干套） */
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
    id: 'suxue',
    name: '素雪',
    tagline: '默认 · 冷白',
    description: '冷白纸面、墨灰文字、一点朱印。近乎无色相，先把内容和棋盘让出来。',
    tokens: suxue,
    variants: { button: 'flat', panel: 'paper', playerMark: 'seal', result: 'plain' },
    builtin: true,
    author: 'xingyi',
    version: '1.0.0',
  },
  {
    id: 'xuanmo',
    name: '玄墨',
    tagline: '默认深色',
    description: '炭灰底、月光银、朱砂印。夜里下棋用的一套；三层灰阶撑层级，棋子带高光。',
    tokens: xuanmo,
    variants: { button: 'soft', panel: 'solid', playerMark: 'seal', result: 'card' },
    builtin: true,
    author: 'xingyi',
    version: '1.0.0',
  },
  {
    id: 'qingzhu',
    name: '青竹',
    tagline: '竹绿',
    description: '竹青纸底、竹叶绿、竹黄盘面。绿而不甜，中圆角加一层轻投影。',
    tokens: qingzhu,
    variants: { button: 'soft', panel: 'solid', playerMark: 'seal', result: 'card' },
    builtin: true,
    author: 'xingyi',
    version: '1.0.0',
  },
  {
    id: 'yinxing',
    name: '银杏',
    tagline: '暖黄',
    description: '奶油纸底、银杏金、赭石印。四套里唯一偏暖的一套，像翻旧书页。',
    tokens: yinxing,
    variants: { button: 'soft', panel: 'paper', playerMark: 'seal', result: 'card' },
    builtin: true,
    author: 'xingyi',
    version: '1.0.0',
  },
];

/**
 * 导入主题的本地缓存。
 * 为什么放 localStorage：App.tsx 只在启动时读 localStorage 里的 themeId 并立刻 skinById()。
 * 缓存让「刷新后仍记得导入的主题」在这个前提下也成立；服务端列表随后由 packs.syncThemes() 校正。
 */
const CUSTOM_CACHE_KEY = 'xingyi.themes.custom';

/** 内置主题 + 已缓存的自定义主题里找；找不到回退默认（素雪） */
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

/**
 * 补齐缺失的 token。旧版本缓存下来的自定义主题没有棋子四个停点，
 * 直接用会让渐变失效（黑子变纯色）——所以进来先跟默认值合一次。
 */
function withDefaultTokens(t: Partial<ThemeTokens> | undefined): ThemeTokens {
  const d = suxue;
  return {
    color: { ...d.color, ...(t?.color ?? {}) },
    radius: { ...d.radius, ...(t?.radius ?? {}) },
    shadow: (t?.shadow ?? d.shadow) as ThemeTokens['shadow'],
    density: t?.density ?? d.density,
    motion: { ...d.motion, ...(t?.motion ?? {}) },
    font: { ...d.font, ...(t?.font ?? {}) },
    decor: Array.isArray(t?.decor) ? t.decor : d.decor,
    playerMark: t?.playerMark ?? d.playerMark,
  };
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
      upsertSkin({ ...s, tokens: withDefaultTokens(s.tokens), builtin: false });
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
    '--stone-black-highlight': t.color.blackStoneHighlight,
    '--stone-black-edge': t.color.blackStoneEdge,
    '--stone-white-highlight': t.color.whiteStoneHighlight,
    '--stone-white-edge': t.color.whiteStoneEdge,
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
