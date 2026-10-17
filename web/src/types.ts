export type {
  AnalysisCandidate,
  AnalysisResult,
  Backend,
  Caps,
  Color,
  EngineState,
  EngineStatus,
  GameResult,
  GameSnapshot,
  GameStatus,
  HardwareReport,
  Mode,
  MoveRecord,
  ScoreDetail,
  ThemeTokens,
  Vertex,
} from '@xingyi/shared';
export {
  CAPS,
  CAP_NOTES,
  MODE_NAMES,
  MODE_TAGLINES,
  PASS,
  gtpToVertex,
  levelCn,
  levelCnFormal,
  vertexToGtp,
} from '@xingyi/shared';

export interface AppConfigLike {
  engine: {
    binaryPath: string | null;
    backend: 'cuda' | 'opencl' | 'eigen';
    modelPath: string | null;
    humanModelPath: string | null;
    configPath: string | null;
    extraArgs: string[];
  };
  ui: {
    themeId: string;
    sound: boolean;
    soundPack: 'jade' | 'porcelain' | 'wood';
    soundVolume: number;
    hoverMark: 'square' | 'ghost';
    showOwnership: boolean;
    analysisDepth: 'quick' | 'standard' | 'deep';
    playerColor: 'B' | 'W';
  };
  game: {
    maxLevel: number;
    komi: number;
    boardSize: 9 | 13 | 19;
    aiResign: boolean;
  };
  playerName: string;
}

export interface PlacementView {
  stage: number;
  lo: number;
  hi: number;
  current: number;
  results: { level: number; won: boolean }[];
  done: boolean;
}

export interface ProgressView {
  playerName: string;
  level: number;
  levelCn: string;
  R: number;
  RD: number;
  provisional: boolean;
  gamesTotal: number;
  levelGames: number;
  levelWins: number;
  streak: number;
  bestStreak: number;
  protection: number;
  demotionBuffer: number;
  pendingPromotion: boolean;
  placement: PlacementView;
  maxLevel: number;
  nextLevelRating: number | null;
  ranksCalibrated: boolean;
  history: {
    at: string;
    level: number;
    won: boolean;
    scoreDiff: number;
    moves: number;
    deltaR: number;
    levelAfter: number;
    text?: string;
  }[];
}

export interface Settlement {
  counted: boolean;
  reason?: string;
  won?: boolean;
  deltaR?: number;
  level?: number;
  levelCn?: string;
  levelChange?: 'up' | 'down' | null;
  streak?: number;
  provisional?: boolean;
  pendingPromotion?: boolean;
  notes?: string[];
  placement?: { stage: number; done: boolean; level: number };
}
