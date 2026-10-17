import {
  PASS,
  isValidVertex,
  type Color,
  type GameStatus,
  type MoveRecord,
  type Vertex,
} from '@xingyi/shared';
import { Board, opposite } from './board.js';
import { scoreArea, scoreText, type ScoreDetailLocal } from './score.js';

export type PlayError =
  | 'finished'
  | 'occupied'
  | 'suicide'
  | 'superko'
  | 'out_of_range'
  | 'not_your_turn';

const ERROR_TEXT: Record<PlayError, string> = {
  finished: '对局已结束',
  occupied: '该点已有棋子',
  suicide: '这是自杀点：落下去自己的棋没有气',
  superko: '全局同形禁着（劫）',
  out_of_range: '落点超出棋盘',
  not_your_turn: '还没轮到你',
};

export interface PlayOutcome {
  ok: boolean;
  error?: PlayError;
  message?: string;
  captured?: Vertex[];
}

export interface SetupStones {
  black?: Vertex[];
  white?: Vertex[];
}

export interface GameOptions {
  size: number;
  komi: number;
  handicap?: number;
  toPlay?: Color;
  setup?: SetupStones;
}

/**
 * 一局棋的规则状态：轮次、落子、劫、superko、数子。
 * 只管规则，不管模式与 AI（那些在 server 的 Match 里）。
 */
export class Game {
  readonly size: number;
  readonly komi: number;
  readonly handicap: number;
  readonly setup: Required<SetupStones>;

  board: Board;
  toPlay: Color;
  moves: MoveRecord[] = [];
  /** 各色被提子数：captures.B = 黑棋被提多少子 */
  captures: { B: number; W: number } = { B: 0, W: 0 };
  status: GameStatus = 'playing';
  deadStones: Vertex[] = [];
  lastMove: Vertex | null = null;
  consecutivePasses = 0;

  private positions = new Set<string>();
  private readonly initialToPlay: Color;

  constructor(opts: GameOptions) {
    this.size = opts.size;
    this.komi = opts.komi;
    this.handicap = opts.handicap ?? 0;
    this.setup = { black: opts.setup?.black ?? [], white: opts.setup?.white ?? [] };
    this.board = new Board(opts.size);
    for (const v of this.setup.black) this.board.set(v, 1);
    for (const v of this.setup.white) this.board.set(v, 2);
    const hasSetupBlack = this.setup.black.length > 0;
    const hasSetupWhite = this.setup.white.length > 0;
    this.initialToPlay = opts.toPlay ?? (hasSetupBlack && !hasSetupWhite ? 'W' : 'B');
    this.toPlay = this.initialToPlay;
    this.positions.add(this.board.fingerprint());
  }

  get ply(): number {
    return this.moves.length;
  }

  private rebuild(): void {
    this.board = new Board(this.size);
    for (const v of this.setup.black) this.board.set(v, 1);
    for (const v of this.setup.white) this.board.set(v, 2);
    this.captures = { B: 0, W: 0 };
    this.positions = new Set([this.board.fingerprint()]);
    this.lastMove = null;
    this.consecutivePasses = 0;
    const replay = this.moves;
    this.moves = [];
    this.toPlay = this.initialToPlay;
    for (const m of replay) {
      this.applyUnchecked(m.color, m.vertex);
    }
  }

  /** 不校验，直接落（用于回放）。 */
  private applyUnchecked(color: Color, vertex: Vertex): Vertex[] {
    if (vertex === PASS) {
      this.moves.push({ color, vertex: PASS, captured: [] });
      this.lastMove = PASS;
      this.consecutivePasses += 1;
      this.toPlay = opposite(color);
      return [];
    }
    const res = this.board.place(color, vertex);
    this.moves.push({ color, vertex, captured: res.captured });
    this.captures[opposite(color)] += res.captured.length;
    this.positions.add(this.board.fingerprint());
    this.lastMove = vertex;
    this.consecutivePasses = 0;
    this.toPlay = opposite(color);
    return res.captured;
  }

  /** 试落，不改状态（界面预判、离线 AI 搜索都用它）。 */
  preview(color: Color, vertex: Vertex): PlayOutcome {
    if (this.status === 'scoring')
      return { ok: false, error: 'finished', message: '双方已停手，先确认死子再结算' };
    if (this.status !== 'playing') return { ok: false, error: 'finished', message: ERROR_TEXT.finished };
    if (vertex === PASS) return { ok: true, captured: [] };
    if (!isValidVertex(this.size, vertex))
      return { ok: false, error: 'out_of_range', message: ERROR_TEXT.out_of_range };
    if (this.board.at(vertex) !== 0) return { ok: false, error: 'occupied', message: ERROR_TEXT.occupied };
    // 合法性以「真落一手」为准：提子腾出的气、并上自己人的气，都在 place 里算准
    const copy = this.board.clone();
    const res = copy.place(color, vertex);
    if (res.suicide) return { ok: false, error: 'suicide', message: ERROR_TEXT.suicide };
    if (this.positions.has(copy.fingerprint()))
      return { ok: false, error: 'superko', message: ERROR_TEXT.superko };
    return { ok: true, captured: res.captured };
  }

  play(color: Color, vertex: Vertex): PlayOutcome {
    if (color !== this.toPlay)
      return { ok: false, error: 'not_your_turn', message: ERROR_TEXT.not_your_turn };
    const check = this.preview(color, vertex);
    if (!check.ok) return check;
    const captured = this.applyUnchecked(color, vertex);
    if (this.consecutivePasses >= 2) this.status = 'scoring';
    return { ok: true, captured };
  }

  /** 双方同意停手（界面的「终局」按钮）：不记 pass 手，只进入待数子状态。 */
  stop(): void {
    if (this.status === 'playing') this.status = 'scoring';
  }

  /** 任意悔棋：回到第 ply 手（0 = 开局），逐手回放重建（361 格，代价可忽略）。 */
  undoTo(ply: number): void {
    const target = Math.max(0, Math.min(ply, this.moves.length));
    if (target === this.moves.length) return;
    this.moves = this.moves.slice(0, target);
    this.status = 'playing';
    this.deadStones = [];
    this.rebuild();
    if (this.moves.length === 0) {
      this.positions = new Set([this.board.fingerprint()]);
    }
  }

  score(dead: Vertex[] = this.deadStones): ScoreDetailLocal {
    return scoreArea(this.size, this.board.grid, this.komi, dead);
  }

  /** 双方停手后，人工确认死子并数子。 */
  finishByScore(dead: Vertex[] = []): { detail: ScoreDetailLocal; text: string } {
    this.deadStones = [...dead];
    const detail = this.score(dead);
    this.status = 'finished';
    return { detail, text: scoreText(detail) };
  }

  resign(color: Color): string {
    this.status = 'finished';
    return `${color === 'B' ? '白' : '黑'}中盘胜`;
  }

  isLegal(color: Color, vertex: Vertex): boolean {
    return this.preview(color, vertex).ok;
  }
}
