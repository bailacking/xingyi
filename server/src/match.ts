import { opposite, Game, type ScoreDetailLocal } from '@xingyi/rules';
import type {
  BoardSize,
  Color,
  GameResult,
  GameSnapshot,
  Mode,
  ScoreDetail,
  Vertex,
} from '@xingyi/shared';
import { PASS } from '@xingyi/shared';

export type Opponent = 'katago' | 'offline' | 'human';

export interface MatchInit {
  id: string;
  mode: Mode;
  size: BoardSize;
  komi: number;
  level: number;
  playerColor: Color;
  opponent: Opponent;
  handicap?: number;
  setup?: { black: Vertex[]; white: Vertex[] };
  /** 谁先走（导入棋谱时按 PL 还原） */
  toPlay?: Color;
  /** 定级赛对局 */
  isPlacement?: boolean;
  /** 跳档考核局 */
  examLevel?: number | null;
}

/** 一局 = 规则状态 + 模式元信息。规则的事交给 @xingyi/rules。 */
export class Match {
  readonly id: string;
  readonly mode: Mode;
  readonly level: number;
  readonly playerColor: Color;
  readonly opponent: Opponent;
  readonly isPlacement: boolean;
  readonly examLevel: number | null;
  readonly game: Game;
  readonly size: BoardSize;
  readonly createdAt: string;
  updatedAt: string;

  aiThinking = false;
  result?: GameResult;
  score?: ScoreDetail;
  /** 结算后由 GameService 填 */
  settlement?: unknown;

  constructor(init: MatchInit) {
    this.id = init.id;
    this.mode = init.mode;
    this.size = init.size;
    this.level = init.level;
    this.playerColor = init.playerColor;
    this.opponent = init.opponent;
    this.isPlacement = init.isPlacement ?? false;
    this.examLevel = init.examLevel ?? null;
    this.game = new Game({
      size: init.size,
      komi: init.komi,
      handicap: init.handicap,
      setup: init.setup,
      toPlay: init.toPlay ?? 'B',
    });
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  get aiColor(): Color {
    return opposite(this.playerColor);
  }

  get finished(): boolean {
    return this.game.status === 'finished';
  }

  touch(): void {
    this.updatedAt = new Date().toISOString();
  }

  applyScore(detail: ScoreDetailLocal, text: string): GameResult {
    this.score = detail as ScoreDetail;
    this.result = {
      winner: detail.winner,
      reason: 'score',
      text,
      margin: detail.margin,
    };
    return this.result;
  }

  applyResign(loser: Color): GameResult {
    const text = this.game.resign(loser);
    this.result = { winner: opposite(loser), reason: 'resign', text };
    return this.result;
  }

  applyQuit(loser: Color): GameResult {
    this.game.status = 'finished';
    const text = `${loser === 'B' ? '白' : '黑'}中盘胜（对方退出）`;
    this.result = { winner: opposite(loser), reason: 'quit', text };
    return this.result;
  }

  snapshot(): GameSnapshot {
    return {
      id: this.id,
      mode: this.mode,
      size: this.size,
      komi: this.game.komi,
      handicap: this.game.handicap,
      level: this.level,
      playerColor: this.playerColor,
      toPlay: this.game.toPlay,
      grid: Array.from(this.game.board.grid),
      moves: this.game.moves,
      lastMove: this.game.lastMove,
      captures: { ...this.game.captures },
      status: this.game.status,
      result: this.result,
      deadStones: this.game.deadStones,
      score: this.score,
      aiThinking: this.aiThinking,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /** AI 该走子？ */
  aiToMove(): boolean {
    return (
      !this.finished &&
      this.game.status === 'playing' &&
      this.opponent !== 'human' &&
      this.game.toPlay === this.aiColor
    );
  }

  /** 人类该走子？（无 AI 的局 = 同机双人，两边都能落子） */
  humanToMove(): boolean {
    if (this.finished || this.game.status !== 'playing') return false;
    if (this.opponent === 'human') return true;
    return this.game.toPlay === this.playerColor;
  }

  moveList(): { color: Color; vertex: Vertex }[] {
    return this.game.moves.map((m) => ({ color: m.color, vertex: m.vertex === PASS ? PASS : m.vertex }));
  }
}
