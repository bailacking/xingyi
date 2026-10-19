/**
 * 全局共享类型：前后端唯一事实来源。
 * 修改前先读 AGENTS.md §6（不变量），别在这里加"顺手"的字段。
 */

export type Color = 'B' | 'W';
export type BoardSize = 9 | 13 | 19;
export type Mode = 'ranked' | 'free' | 'lan';

/** 落子点用一维下标：index = y * size + x，x 从左、y 从上。 */
export type Vertex = number;

/** 停一手。不用 null，避免 JSON 里 null / undefined 混用。 */
export const PASS: Vertex = -1;

export const DEFAULT_KOMI = 7.5;
export const BOARD_SIZES: BoardSize[] = [9, 13, 19];

/** 模式 = 能力门禁（AGENTS.md §6）。所有界面控件读这张表，禁止散落 if (mode === ...)。 */
export interface Caps {
  /** 显示胜率 / 目差 */
  showWinrate: boolean;
  /** 每手点评 */
  showComment: boolean;
  allowUndo: boolean;
  /** 摆棋分析 / AI 实时推荐 */
  allowAnalysis: boolean;
  /** 导入外部 SGF */
  allowImport: boolean;
  /** AI 等级锁定为当前级 */
  rankLocked: boolean;
  countsToProgress: boolean;
  quitLoses: boolean;
  /** 自由摆子（AB/AW/AE） */
  allowBoardEdit: boolean;
  /** 对局前自选 AI 等级 */
  allowLevelSelect: boolean;
  /** 有 AI 对手 */
  hasAi: boolean;
}

export const CAPS: Record<Mode, Caps> = {
  ranked: {
    showWinrate: false,
    showComment: false,
    allowUndo: false,
    allowAnalysis: false,
    allowImport: false,
    rankLocked: true,
    countsToProgress: true,
    quitLoses: true,
    allowBoardEdit: false,
    allowLevelSelect: false,
    hasAi: true,
  },
  free: {
    showWinrate: true,
    showComment: true,
    allowUndo: true,
    allowAnalysis: true,
    allowImport: true,
    rankLocked: false,
    countsToProgress: false,
    quitLoses: false,
    allowBoardEdit: true,
    allowLevelSelect: true,
    hasAi: true,
  },
  lan: {
    showWinrate: true,
    showComment: true,
    allowUndo: true,
    allowAnalysis: false,
    allowImport: false,
    rankLocked: false,
    countsToProgress: false,
    quitLoses: true,
    allowBoardEdit: false,
    allowLevelSelect: false,
    hasAi: false,
  },
};

export const MODE_NAMES: Record<Mode, string> = {
  ranked: '修习',
  free: '自在',
  lan: '手谈',
};

export const MODE_TAGLINES: Record<Mode, string> = {
  ranked: '有代价，有成长线',
  free: '无代价，随便试',
  lan: '人对人',
};

/** 置灰时的说明文字：告诉用户"为什么不能用"，而不是让他猜。 */
export const CAP_NOTES: Partial<Record<keyof Caps, string>> = {
  showWinrate: '修习模式不显示胜率与目差',
  showComment: '修习模式不给每手点评',
  allowUndo: '修习模式不允许悔棋',
  allowAnalysis: '修习模式不可用分析（等于开卷考试）',
  allowImport: '修习模式不可导入外部棋谱',
  allowBoardEdit: '对局中不可摆子',
  allowLevelSelect: '修习模式的对手固定为你的当前级',
};

// ---------------------------------------------------------------- 对局

export interface MoveRecord {
  color: Color;
  /** PASS 表示停一手 */
  vertex: Vertex;
  /** 本手提掉的对方棋子下标 */
  captured: Vertex[];
  /** 着法名（提子/打吃/接/长/立/跳/飞/尖；拿不准就没有） */
  name?: string;
}

export type GameStatus = 'playing' | 'scoring' | 'finished';
export type EndReason = 'score' | 'resign' | 'quit' | 'timeout' | 'draw' | 'engine';

export interface GameResult {
  winner: Color | null;
  reason: EndReason;
  /** 界面直接显示的中文结论，如「白中盘胜」「黑胜 3.5 目」 */
  text: string;
  /** 目差（数子结果差），认输时缺省 */
  margin?: number;
}

export interface ScoreDetail {
  /** 黑方地域（子 + 空） */
  blackArea: number;
  whiteArea: number;
  /** 白方贴目 */
  komi: number;
  /** 黑 - (白 + 贴目) */
  diff: number;
  winner: Color | null;
  margin: number;
  /** 判定为空的点（ territorio 明细，供前端涂色） */
  blackTerritory: Vertex[];
  whiteTerritory: Vertex[];
}

/** 时间制：主时间 + 读秒（包干时 periods = 0） */
export interface TimeControl {
  mainSec: number;
  byoYomiSec: number;
  periods: number;
}

export interface ClockView {
  /** 当前这一段还剩多少毫秒（主时间或本次读秒） */
  blackMs: number;
  whiteMs: number;
  /** 还剩几期读秒 */
  periods: { B: number; W: number };
  /** 正在走谁的表；null = 暂停 */
  running: Color | null;
  /** 已经进入读秒 */
  inByoYomi: { B: boolean; W: boolean };
  control: TimeControl;
}

export interface GameSnapshot {
  id: string;
  mode: Mode;
  size: BoardSize;
  komi: number;
  handicap: number;
  /** AI 等级 1..15；lan 模式无意义 */
  level: number;
  playerColor: Color;
  toPlay: Color;
  grid: number[];
  moves: MoveRecord[];
  lastMove: Vertex | null;
  /** 各色被提子数 */
  captures: { B: number; W: number };
  status: GameStatus;
  result?: GameResult;
  /** 结算阶段：待确认死子 */
  deadStones?: Vertex[];
  score?: ScoreDetail;
  aiThinking?: boolean;
  /** 还有被悔掉的棋可以重做 */
  canRedo?: boolean;
  /** 计时；null/缺省 = 不限时 */
  clock?: ClockView | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- 手谈（联机）

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomView {
  code: string;
  size: BoardSize;
  komi: number;
  status: RoomStatus;
  toPlay: Color;
  grid: number[];
  moves: { color: Color; vertex: Vertex }[];
  lastMove: Vertex | null;
  black: string | null;
  white: string | null;
  spectators: number;
  result: string | null;
  /** 终局原因（W2：超时/认输/离开/数子）；旧数据可能缺省 */
  resultReason?: EndReason | null;
  /** 棋钟；null/缺省 = 不限时 */
  clock?: ClockView | null;
  /** 有人申请悔棋，等对方同意 */
  undoRequest: { by: Color } | null;
  createdAt: string;
}

export interface RoomChat {
  id: number;
  name: string;
  text: string;
  at: string;
}

export interface RoomSeat {
  room: RoomView;
  color: Color | 'spectator';
}

// ---------------------------------------------------------------- 分析

export interface AnalysisCandidate {
  /** GTP 坐标，如 "Q16"；"pass" 表示停一手 */
  move: string;
  vertex: Vertex;
  visits: number;
  /** 0..1 */
  winrate: number;
  /** 对"轮到的一方"的目差，正数=领先 */
  scoreLead: number;
  prior: number;
  order: number;
  /** 主变化（GTP 坐标，最多 10 手） */
  pv: string[];
}

/** 复盘：一手棋的评价 */
export type ReviewLabel = 'good' | 'normal' | 'mistake' | 'unknown';

export interface ReviewPoint {
  /** 第几手（1 起；0 表示开局前，不用于复盘点） */
  ply: number;
  /** 黑方胜率（已从"行棋方视角"换算） */
  winrateBlack: number | null;
  /** 黑方目差（正=黑领先） */
  scoreLeadBlack: number | null;
  /** 这一手相对最佳着法损失了多少目 */
  loss: number | null;
  /** 胜率损失（0..1，按落子方视角） */
  lossWinrate: number | null;
  label: ReviewLabel;
}

export interface ReviewResult {
  size: BoardSize;
  komi: number;
  points: ReviewPoint[];
  summary: { good: number; normal: number; mistake: number; unknown: number };
  /** 是否因为盘面太长而截断 */
  truncated: boolean;
}

export interface AnalysisResult {
  /** 分析时轮到谁 */
  turn: Color;
  /** 局面指纹，前端用它丢掉过期结果 */
  fingerprint: string;
  rootVisits: number;
  candidates: AnalysisCandidate[];
  /** 361/169/81 个 [-1,1]，行主序 A19→T1；1=黑 */
  ownership: number[] | null;
  /** 引擎来源：katago 或 offline */
  source: 'katago' | 'offline';
  /** 分析耗时（毫秒） */
  elapsedMs: number;
}

// ---------------------------------------------------------------- 引擎

export type Backend = 'cuda' | 'opencl' | 'eigen';
export type EngineState =
  | 'unconfigured'
  | 'starting'
  | 'ready'
  | 'thinking'
  | 'analyzing'
  | 'crashed'
  | 'offline';

export interface EngineStatus {
  state: EngineState;
  backend: Backend;
  /** katago 可执行文件路径 */
  binaryPath: string | null;
  modelPath: string | null;
  humanModelPath: string | null;
  /** 引擎自报版本 */
  version: string | null;
  /** 最近一次失败的中文原因 */
  error: string | null;
  /** 离线对手可用（未配置引擎时的兜底） */
  offlineAvailable: boolean;
  pid: number | null;
}

export interface HardwareReport {
  os: string;
  cpu: string;
  /** 探测到的显卡名（多个） */
  gpus: string[];
  /** 显存 MB，未知为 null */
  vramMb: number | null;
  nvidiaSmi: boolean;
  recommended: Backend;
  /** 推荐理由（中文，直接展示） */
  reason: string;
  warnings: string[];
}

// ---------------------------------------------------------------- 主题

export type Density = 'comfortable' | 'compact';
export type PlayerMark = 'seal' | 'avatarCard';

export interface ThemeTokens {
  color: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    primary: string;
    accent: string;
    text: string;
    textDim: string;
    line: string;
    board: string;
    boardEdge: string;
    boardLine: string;
    blackStone: string;
    whiteStone: string;
    seal: string;
    sealText: string;
    danger: string;
    ok: string;
  };
  radius: { sm: number; md: number; lg: number };
  /** 0=几乎无阴影，3=柔光 */
  shadow: 0 | 1 | 2 | 3;
  density: Density;
  motion: { speed: number; bounce: boolean };
  font: { title: string; body: string };
  decor: string[];
  playerMark: PlayerMark;
}

export interface ThemeVariants {
  button: 'flat' | 'soft' | 'glow';
  panel: 'paper' | 'glass' | 'solid';
  playerMark: PlayerMark;
  result: 'plain' | 'card';
}

export interface ThemePack {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  /** 是否内置主题（内置不可删除） */
  builtin: boolean;
  tokens: ThemeTokens;
  variants: ThemeVariants;
  /** 可选 CSS 文本；禁止 @import 与远程 URL（AGENTS.md §12） */
  css?: string;
}
