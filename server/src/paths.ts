import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/src 或 server/dist 的上一级 = server/ ，再上一级 = 仓库根 */
const serverRoot = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(serverRoot, '..');

export interface DataPaths {
  root: string;
  data: string;
  games: string;
  backups: string;
  logs: string;
  themes: string;
  configFile: string;
  progressFile: string;
  ranksFile: string;
}

/** 数据目录：开发期在仓库内 `data/`；可用 XINGYI_DATA 覆盖（Electron 后指 %APPDATA%）。 */
export function dataPaths(root = process.env.XINGYI_DATA ?? path.join(REPO_ROOT, 'data')): DataPaths {
  return {
    root,
    data: root,
    games: path.join(root, 'games'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs'),
    themes: path.join(root, 'themes'),
    configFile: path.join(root, 'config.json'),
    progressFile: path.join(root, 'progress.json'),
    ranksFile: path.join(root, 'ranks.json'),
  };
}
