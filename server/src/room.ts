import { Game } from '@xingyi/rules';
import {
  PASS,
  type BoardSize,
  type Color,
  type EndReason,
  type RoomChat,
  type RoomStatus,
  type RoomView,
  type TimeControl,
  type Vertex,
} from '@xingyi/shared';
import { Clock } from './clock.js';

export interface Seat {
  clientId: string;
  name: string;
}

/** 房间空转超时：两人都在但谁都不动，3 分钟后判「对方没动」。与棋钟无关，别混。 */
const IDLE_MS = 3 * 60 * 1000;

/**
 * 一个联机房间：服务端权威（房主只是"开始的人"，规则一视同仁）。
 * 只做落子/停一手/认输/悔棋征得同意/聊天，**不接 AI**（AGENTS.md §2：联机纯净）。
 *
 * 计时直接复用 `clock.ts`：主时间用完进读秒、读秒每手重置、期数用完判负。
 * 语义与 `Match` 完全一致，不要在这里另写一套。
 */
export class Room {
  readonly code: string;
  readonly size: BoardSize;
  readonly komi: number;
  readonly game: Game;
  /** 时间制；null = 不限时 */
  readonly timeControl: TimeControl | null;
  readonly clock: Clock | null;
  black: Seat | null = null;
  white: Seat | null = null;
  readonly spectators = new Map<string, string>();
  readonly chat: RoomChat[] = [];
  undoRequest: { by: Color } | null = null;
  status: RoomStatus = 'waiting';
  result: string | null = null;
  resultReason: EndReason | null = null;
  lastMoveAt = Date.now();
  readonly createdAt = new Date().toISOString();
  private chatSeq = 0;

  constructor(code: string, size: BoardSize, komi: number, timeControl: TimeControl | null = null) {
    this.code = code;
    this.size = size;
    this.komi = komi;
    this.timeControl = timeControl;
    this.clock = timeControl ? new Clock(timeControl) : null;
    this.game = new Game({ size, komi });
  }

  seat(clientId: string, name: string): Color | 'spectator' {
    if (this.black?.clientId === clientId) return 'B';
    if (this.white?.clientId === clientId) return 'W';
    if (!this.black) {
      this.black = { clientId, name };
      this.syncStatus();
      return 'B';
    }
    if (!this.white) {
      this.white = { clientId, name };
      this.syncStatus();
      return 'W';
    }
    this.spectators.set(clientId, name);
    return 'spectator';
  }

  colorOf(clientId: string): Color | 'spectator' | null {
    if (this.black?.clientId === clientId) return 'B';
    if (this.white?.clientId === clientId) return 'W';
    if (this.spectators.has(clientId)) return 'spectator';
    return null;
  }

  nameOf(clientId: string): string {
    if (this.black?.clientId === clientId) return this.black.name;
    if (this.white?.clientId === clientId) return this.white.name;
    return this.spectators.get(clientId) ?? '观众';
  }

  private syncStatus(): void {
    if (this.status === 'finished') return;
    const next: RoomStatus = this.black && this.white ? 'playing' : 'waiting';
    if (next === this.status) return;
    this.status = next;
    // 两人到齐才开表；只坐了一个人时表是停的（否则房主等人也在扣时间）
    if (this.clock) {
      if (next === 'playing') this.clock.start(this.game.toPlay);
      else this.clock.pause();
    }
  }

  /**
   * 推进棋钟并处理超时判负。**幂等**：REST 快照和秒级 ticker 都会调，
   * `Clock.switchTo` 同色重复调用不重置读秒（AGENTS.md §15.18）。
   */
  syncClock(now = Date.now()): Color | null {
    if (!this.clock || this.status !== 'playing') return null;
    const flagged = this.clock.tick(now);
    if (!flagged) return null;
    this.applyTimeout(flagged);
    return flagged;
  }

  private applyTimeout(loser: Color): void {
    this.status = 'finished';
    this.clock?.pause();
    const win: Color = loser === 'B' ? 'W' : 'B';
    this.resultReason = 'timeout';
    this.result = `${loser === 'B' ? '黑' : '白'}超时，${win === 'B' ? '黑' : '白'}胜`;
  }

  /** 房间空转超时（与棋钟无关）：两人都不动 3 分钟 */
  private checkIdle(): void {
    if (this.status !== 'playing') return;
    if (Date.now() - this.lastMoveAt <= IDLE_MS) return;
    const loser = this.game.toPlay;
    this.status = 'finished';
    this.clock?.pause();
    this.resultReason = 'quit';
    this.result = `${loser === 'B' ? 'W' : 'B'}+T（对手 3 分钟没动）`;
  }

  snapshot(): RoomView {
    this.syncClock();
    this.checkIdle();
    return {
      code: this.code,
      size: this.size,
      komi: this.komi,
      status: this.status,
      toPlay: this.game.toPlay,
      grid: Array.from(this.game.board.grid),
      moves: this.game.moves.map((m) => ({ color: m.color, vertex: m.vertex })),
      lastMove: this.game.lastMove,
      black: this.black?.name ?? null,
      white: this.white?.name ?? null,
      spectators: this.spectators.size,
      result: this.result,
      resultReason: this.resultReason,
      clock: this.clock?.view() ?? null,
      undoRequest: this.undoRequest,
      createdAt: this.createdAt,
    };
  }

  play(clientId: string, vertex: Vertex): void {
    const color = this.colorOf(clientId);
    if (color !== 'B' && color !== 'W') throw new RoomError(403, '观众不能落子');
    if (this.status === 'finished') throw new RoomError(400, '这盘已经结束了');
    if (this.status === 'waiting') throw new RoomError(400, '还在等人，两个人都到齐才能下');
    if (this.game.toPlay !== color) throw new RoomError(400, '现在轮不到你');
    // 先结账再落子：表已经走完的这手不算数（否则会「超时后还多下一手」）
    if (this.syncClock()) throw new RoomError(400, '你的时间用完了，这局已经判负');
    const res = this.game.play(color, vertex);
    if (!res.ok) throw new RoomError(400, res.message ?? '这一手不能下');
    this.undoRequest = null;
    this.lastMoveAt = Date.now();
    this.clock?.switchTo(this.game.toPlay);
  }

  pass(clientId: string): void {
    this.play(clientId, PASS);
    if (this.game.status !== 'playing') {
      const out = this.game.finishByScore([]);
      this.status = 'finished';
      this.resultReason = 'score';
      this.result = out.text;
      this.clock?.pause();
    }
  }

  resign(clientId: string): void {
    const color = this.colorOf(clientId);
    if (color !== 'B' && color !== 'W') throw new RoomError(403, '观众不能认输');
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.resultReason = 'resign';
    this.result = `${color === 'B' ? '白' : '黑'}中盘胜（对方认输）`;
    this.clock?.pause();
  }

  requestUndo(clientId: string): void {
    const color = this.colorOf(clientId);
    if (color !== 'B' && color !== 'W') throw new RoomError(403, '只有对局者能申请悔棋');
    if (this.game.moves.length === 0) throw new RoomError(400, '还没有着手');
    if (this.undoRequest) throw new RoomError(400, '已经有一条悔棋申请在等回应');
    this.undoRequest = { by: color };
  }

  answerUndo(clientId: string, accept: boolean): void {
    const color = this.colorOf(clientId);
    if (color !== 'B' && color !== 'W') throw new RoomError(403, '只有对局者能回应');
    if (!this.undoRequest) throw new RoomError(400, '没有待回应的悔棋申请');
    if (this.undoRequest.by === color) throw new RoomError(400, '不能自己同意自己');
    if (accept) {
      this.game.undoTo(Math.max(0, this.game.moves.length - 1));
      this.lastMoveAt = Date.now();
      // 悔棋后轮到谁的表就走谁的（同色重复调用不重置读秒，见 clock.ts）
      this.clock?.switchTo(this.game.toPlay);
    }
    this.undoRequest = null;
  }

  say(clientId: string, text: string): void {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    this.chatSeq += 1;
    this.chat.push({ id: this.chatSeq, name: this.nameOf(clientId), text: clean, at: new Date().toISOString() });
    if (this.chat.length > 100) this.chat.shift();
  }

  leave(clientId: string): void {
    if (this.black?.clientId === clientId) this.black = null;
    if (this.white?.clientId === clientId) this.white = null;
    this.spectators.delete(clientId);
    if (this.status === 'playing') {
      this.status = 'finished';
      this.resultReason = 'quit';
      this.result = '对手离开了房间';
      this.clock?.pause();
    } else {
      this.syncStatus();
    }
  }
}

export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 6 位房间码：去掉容易看错的 0/O/1/I */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!existing.has(code)) return code;
  }
  throw new RoomError(500, '房间码撞车了，再试一次');
}
