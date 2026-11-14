import type { Backend } from '@xingyi/shared';

export type LevelKind = 'human' | 'main';

export interface LevelParams {
  level: number;
  kind: LevelKind;
  /** humanSLProfile 名称；主模型为 null */
  profile: string | null;
  maxVisits: number;
  /** PIKL 抑制强度：越小越强（官方 9d 示例 0.08；1e8 ≈ 完全关闭搜索对选点的影响） */
  lambda: number;
  /** 搜索中按人类策略探索的比例（0.8 = 80% 的访问花在人类可能下的点上） */
  rootExplore: number;
  /** 界面提示用 */
  note: string;
}

// 主模型档位按近似对数间隔分配搜索预算。一级以职业初段为校准目标。
const mainVisits = [160, 112, 80, 40, 20, 10, 5];

// 人类模仿档位按等级向上逐步提升棋风和搜索预算。保留旧阶梯的实测参数作为起点。
const humanVisits = [1, 3, 4, 6, 8, 11, 16, 23, 32, 45, 64, 80, 100, 115, 130, 145, 160];
const humanProfiles = humanVisits.map((maxVisits, index): LevelParams => ({
  level: 25 - index,
  kind: 'human',
  profile: `rank_${20 - index}k`,
  maxVisits,
  lambda: 0.5,
  rootExplore: 0.8,
  note: index === 0 ? '新手起点' : '人类棋风',
}));

export const LEVEL_PARAMS: LevelParams[] = [
  ...mainVisits.map((maxVisits, index): LevelParams => ({
    level: index + 1, kind: 'main', profile: null, maxVisits, lambda: 0, rootExplore: 0,
    note: index === 0 ? '职业初段校准目标' : '主模型搜索',
  })),
  { level: 8, kind: 'human', profile: 'rank_1k', maxVisits: 160, lambda: 0.5, rootExplore: 0.8, note: '人类棋风' },
  ...humanProfiles.reverse(),
];

export function levelParams(level: number): LevelParams {
  const k = Number.isFinite(level) ? Math.min(LEVEL_PARAMS.length, Math.max(1, Math.round(level))) : LEVEL_PARAMS.length;
  return LEVEL_PARAMS[k - 1]!;
}

/** 主模型 + human 模型同在时，用 profile 控制；没有 human 模型就别设（会被引擎拒）。 */
export function needsHumanProfile(level: number): boolean {
  return levelParams(level).kind === 'human';
}

export interface EngineSpawnConfig {
  binaryPath: string;
  backend: Backend;
  modelPath: string;
  humanModelPath?: string | null;
  configPath?: string | null;
  /** 额外命令行参数（高级用户） */
  extraArgs?: string[];
}

/** 组装 `katago gtp` 的命令行参数（不猜不存在的开关）。 */
export function buildGtpArgs(cfg: EngineSpawnConfig): string[] {
  const args = ['gtp', '-model', cfg.modelPath];
  if (cfg.configPath) args.push('-config', cfg.configPath);
  if (cfg.humanModelPath) args.push('-human-model', cfg.humanModelPath);
  for (const extra of cfg.extraArgs ?? []) args.push(extra);
  args.push('-override-config', 'reportAnalysisWinratesAs=BLACK');
  return args;
}

/**
 * 最小 GTP 配置模板。
 * 只写有把握的键；官方 release 的 `gtp_example.cfg` 更全，加载失败就用它替换。
 */
export function configTemplate(backend: Backend): string {
  const batch = backend === 'eigen' ? 1 : 8;
  return `# 星弈生成的 GTP 配置（最小集）
# 若引擎报错，改用 KataGo 官方 release 里的 gtp_example.cfg 再手改。
logToStderr = true
logAllGTPCommunication = false
logSearchInfo = false
logAllRequests = false
ponderingEnabled = false
numSearchThreads = 4
nnMaxBatchSize = ${batch}
nnCacheSizePowerOfTwo = 18
reportAnalysisWinratesAs = BLACK
maxVisits = 500
`;
}
