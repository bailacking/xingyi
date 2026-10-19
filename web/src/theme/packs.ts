/**
 * 主题包（W4）：服务端 `data/themes/` 的列表 / 导入 / 导出。
 *
 * 本地 SKINS 是「内置 3 套 + 已导入的缓存」，服务端列表是「内置 + 全部导入」的真相。
 * 两边的沟通只走 api.ts 的 theme 段；这里不碰任何 CSS/JS 文本，只搬运 token。
 */
import { api } from '../api';
import type { ThemeTokens, ThemeVariants } from '@xingyi/shared';
import { SKINS, dropSkin, persistSkins, upsertSkin, type Skin, type ThemeAsset } from './skins';

/** GET /api/theme 的单项（= 服务端 ThemePackRecord） */
export interface ThemeSummary {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  builtin: boolean;
  tokens: ThemeTokens;
  variants: ThemeVariants;
  assets?: ThemeAsset[];
}

function toSkin(t: ThemeSummary): Skin {
  return {
    id: t.id,
    name: t.name,
    tagline: t.builtin ? '内置' : '导入',
    description: t.description || '（这个主题没有写说明）',
    tokens: t.tokens,
    variants: t.variants,
    builtin: t.builtin,
    author: t.author,
    version: t.version,
    assets: t.assets ?? [],
  };
}

/**
 * 用服务端列表校正本地 SKINS。
 * 内置主题以 skins.ts 为准（与 data/themes/<id>/theme.json 由测试守着一致），
 * 所以这里只 upsert 非内置、并删掉服务端已经没有的导入主题。
 */
export async function syncThemes(): Promise<Skin[]> {
  const { themes } = await api.themeList();
  const seen = new Set<string>();
  for (const t of themes) {
    if (t.builtin) continue;
    seen.add(t.id);
    upsertSkin(toSkin(t));
  }
  for (const s of [...SKINS]) {
    if (!s.builtin && !seen.has(s.id)) dropSkin(s.id);
  }
  persistSkins();
  return [...SKINS];
}

export interface ImportOutcome {
  skin: Skin;
  warnings: string[];
}

/** 导入 zip：服务端校验（token 白名单 / 只允许 json+图片）通过才落盘 */
export async function importThemeFile(file: File): Promise<ImportOutcome> {
  const { theme, warnings } = await api.themeImport(file);
  if (theme.builtin) throw new Error('服务端返回了内置主题，拒绝覆盖');
  const skin = toSkin(theme);
  upsertSkin(skin);
  persistSkins();
  return { skin, warnings };
}

export function exportThemeUrl(id: string): string {
  return api.themeExportUrl(id);
}
