import fs from 'node:fs';
import path from 'node:path';
import type { Backend } from '@xingyi/shared';
import { DEFAULT_KOMI } from '@xingyi/shared';

export interface AppConfig {
  engine: {
    binaryPath: string | null;
    backend: Backend;
    modelPath: string | null;
    humanModelPath: string | null;
    configPath: string | null;
    extraArgs: string[];
  };
  ui: {
    themeId: string;
    sound: boolean;
    /** 音色：玉石 / 青瓷 / 木石 */
    soundPack: 'jade' | 'porcelain' | 'wood';
    /** 音量 0..1 */
    soundVolume: number;
    showOwnership: boolean;
    /** 分析深度档：quick / standard / deep */
    analysisDepth: 'quick' | 'standard' | 'deep';
    playerColor: 'B' | 'W';
  };
  game: {
    maxLevel: number;
    komi: number;
    boardSize: 9 | 13 | 19;
    /** AI 落后太多是否认输 */
    aiResign: boolean;
  };
  playerName: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  engine: {
    binaryPath: null,
    backend: 'cuda',
    modelPath: null,
    humanModelPath: null,
    configPath: null,
    extraArgs: [],
  },
  ui: {
    themeId: 'walnut',
    sound: true,
    soundPack: 'jade',
    soundVolume: 0.75,
    showOwnership: false,
    analysisDepth: 'standard',
    playerColor: 'B',
  },
  game: {
    maxLevel: 15,
    komi: DEFAULT_KOMI,
    boardSize: 19,
    aiResign: true,
  },
  playerName: '无名',
};

function mergeDeep<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const baseVal = (base as Record<string, unknown>)[k];
    if (baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal) && v && typeof v === 'object') {
      out[k] = mergeDeep(baseVal, v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function loadConfig(file: string): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return mergeDeep(DEFAULT_CONFIG, raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(file: string, cfg: AppConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
