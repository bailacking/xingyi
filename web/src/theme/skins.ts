import type { ThemeTokens } from '@xingyi/shared';

const SERIF = '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", SimSun, serif';
const SANS = '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/** 胡桃木（典雅，默认）：米白宣纸 + 深胡桃木 + 细金线（PLAN §11.1） */
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

export const SKINS = [
  {
    id: 'walnut',
    name: '胡桃木',
    tagline: '典雅 · 默认',
    description: '米白宣纸底、深胡桃木、细金线。宋体、直角、几乎无动效。像一间书房。',
    tokens: walnut,
    variants: { button: 'flat', panel: 'paper', playerMark: 'seal', result: 'plain' } as const,
  },
  {
    id: 'youth',
    name: '星弈·青',
    tagline: '墨青夜',
    description: '深青底、金线、柔光。黑体、大圆角、弹性动效。夜里下棋用的那一套。',
    tokens: youth,
    variants: { button: 'glow', panel: 'glass', playerMark: 'seal', result: 'card' } as const,
  },
];

export type Skin = (typeof SKINS)[number];

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]!;
}

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
