import type { Backend } from '@xingyi/shared';

/**
 * 15 级 → 引擎参数（AGENTS.md §9.3）。
 *
 * 1~11 级用 human SL 模型（`rank_*` = 现代人类开局风格），**并且让搜索真正参与选点**：
 * 只设 `humanSLProfile` + `humanSLChosenMoveProp=1` 时，若 lambda 很大，KataGo 的搜索会被忽略，
 * `maxVisits` 调多少都不改棋力（官方 gtp_human5k_example.cfg 明确写了）。
 * 所以这里显式给 `lambda`（PIKL 抑制强度，越小越强）与 `rootExplore`（探索人类着法的比例），
 * 用 `maxVisits` 当一个连续的强度旋钮，档位才可能单调、可校准。
 * 12 级起切主模型：官方警告 human SL 在高段不保证真实强度。
 */
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

export const LEVEL_PARAMS: LevelParams[] = [
  // 1~9：人类风格 + 搜索（lambda/rootExplore 固定，maxVisits 当强度旋钮）
  { level: 1, kind: 'human', profile: 'rank_20k', maxVisits: 1, lambda: 0.5, rootExplore: 0.8, note: '约业余 20 级' },
  { level: 2, kind: 'human', profile: 'rank_18k', maxVisits: 2, lambda: 0.5, rootExplore: 0.8, note: '约业余 18 级' },
  { level: 3, kind: 'human', profile: 'rank_16k', maxVisits: 4, lambda: 0.5, rootExplore: 0.8, note: '约业余 16 级' },
  { level: 4, kind: 'human', profile: 'rank_14k', maxVisits: 8, lambda: 0.5, rootExplore: 0.8, note: '约业余 14 级' },
  { level: 5, kind: 'human', profile: 'rank_12k', maxVisits: 16, lambda: 0.5, rootExplore: 0.8, note: '约业余 12 级' },
  { level: 6, kind: 'human', profile: 'rank_10k', maxVisits: 32, lambda: 0.5, rootExplore: 0.8, note: '约业余 10 级' },
  { level: 7, kind: 'human', profile: 'rank_8k', maxVisits: 64, lambda: 0.5, rootExplore: 0.8, note: '约业余 8 级' },
  { level: 8, kind: 'human', profile: 'rank_6k', maxVisits: 100, lambda: 0.5, rootExplore: 0.8, note: '约业余 6 级' },
  { level: 9, kind: 'human', profile: 'rank_4k', maxVisits: 160, lambda: 0.5, rootExplore: 0.8, note: '约业余 4 级' },
  // 10~15：主模型限 visits。实测 human SL 1k 再往上加访问量几乎不再变强（饱和），
  // 而主模型 5 visits 就已经高它约 140 分，所以从 10 级起换主模型，用访问量做连续刻度。
  { level: 10, kind: 'main', profile: null, maxVisits: 5, lambda: 0, rootExplore: 0, note: '主模型 5 visits' },
  { level: 11, kind: 'main', profile: null, maxVisits: 10, lambda: 0, rootExplore: 0, note: '主模型 10 visits' },
  { level: 12, kind: 'main', profile: null, maxVisits: 20, lambda: 0, rootExplore: 0, note: '主模型 20 visits' },
  { level: 13, kind: 'main', profile: null, maxVisits: 40, lambda: 0, rootExplore: 0, note: '主模型 40 visits' },
  { level: 14, kind: 'main', profile: null, maxVisits: 80, lambda: 0, rootExplore: 0, note: '主模型 80 visits' },
  { level: 15, kind: 'main', profile: null, maxVisits: 160, lambda: 0, rootExplore: 0, note: '主模型 160 visits（满级）' },
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
