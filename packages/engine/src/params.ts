import type { Backend } from '@xingyi/shared';

/**
 * 15 级 → 引擎参数（PLAN §8）。
 *
 * ⚠️ 1~11 级用 human SL 模型（`rank_*` = 现代人类开局风格）；
 * 官方警告：human SL 在高段不保证真实强度（它几乎不搜索），所以 12 级起切主模型限 visits。
 * `maxVisits` 与 `visits` 都是**待实测值**，等 `visits/s` 出来再校准。
 */
export type LevelKind = 'human' | 'main';

export interface LevelParams {
  level: number;
  kind: LevelKind;
  /** humanSLProfile 名称；主模型为 null */
  profile: string | null;
  maxVisits: number;
  /** 界面提示用 */
  note: string;
}

export const LEVEL_PARAMS: LevelParams[] = [
  { level: 1, kind: 'human', profile: 'rank_20k', maxVisits: 1, note: '约业余 20 级' },
  { level: 2, kind: 'human', profile: 'rank_18k', maxVisits: 2, note: '约业余 18 级' },
  { level: 3, kind: 'human', profile: 'rank_16k', maxVisits: 4, note: '约业余 16 级' },
  { level: 4, kind: 'human', profile: 'rank_14k', maxVisits: 6, note: '约业余 14 级' },
  { level: 5, kind: 'human', profile: 'rank_12k', maxVisits: 10, note: '约业余 12 级' },
  { level: 6, kind: 'human', profile: 'rank_10k', maxVisits: 16, note: '约业余 10 级' },
  { level: 7, kind: 'human', profile: 'rank_8k', maxVisits: 24, note: '约业余 8 级' },
  { level: 8, kind: 'human', profile: 'rank_6k', maxVisits: 36, note: '约业余 6 级' },
  { level: 9, kind: 'human', profile: 'rank_4k', maxVisits: 60, note: '约业余 4 级' },
  { level: 10, kind: 'human', profile: 'rank_2k', maxVisits: 90, note: '约业余 2 级' },
  { level: 11, kind: 'human', profile: 'rank_1k', maxVisits: 140, note: '约业余 1 级' },
  { level: 12, kind: 'main', profile: null, maxVisits: 300, note: '约业余 1 段' },
  { level: 13, kind: 'main', profile: null, maxVisits: 800, note: '约业余 2~3 段' },
  { level: 14, kind: 'main', profile: null, maxVisits: 1500, note: '约业余 4 段' },
  { level: 15, kind: 'main', profile: null, maxVisits: 3000, note: '满级 · 约业余 5~7 段' },
];

export function levelParams(level: number): LevelParams {
  const k = Math.min(LEVEL_PARAMS.length, Math.max(1, Math.round(level)));
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
