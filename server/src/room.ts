import { Game } from '@xingyi/rules';
import {
  PASS,
  type BoardSize,
  type Color,
  type RoomChat,
  type RoomStatus,
  type RoomView,
  type Vertex,
} from '@xingyi/shared';

export interface Seat {
  clientId: string;
  name: string;
}

const TIMEOUT_MS = 3 * 60 * 1000;

/**
 * 一个联机房间：服务端权威（房主只是"开始的人"，规则一视同仁）。
 * 只做落子/停一手/认输/悔棋征得同意/聊天，**不接 AI**（AGENTS.md §2：联机纯净）。
 */
export class Room {
  readonly code: string;
  readonly size: BoardSize;
  readonly komi: number;
  readonly game: Game;
  black: Seat | null = null;
  white: Seat | null = null;
  readonly spectators = new Map<string, string>();
  readonly chat: RoomChat[] = [];
  undoRequest: { by: Color } | null = null;
  status: RoomStatus = 'waiting';
  result: string | null = null;
  lastMoveAt = Date.now();
  readonly createdAt = new Date().toISOString();
  private chatSeq = 0;

  constructor(code: string, size: BoardSize, komi: number) {
    this.code = code;
    this.size = size;
    this.komi = komi;
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
    this.status = this.black && this.white ? 'playing' : 'waiting';
  }

  private checkTimeout(): void {
    if (this.status !== 'playing') return;
    if (Date.now() - this.lastMoveAt <= TIMEOUT_MS) return;
    const loser = this.game.toPlay;
    this.status = 'finished';
    this.result = `${loser === 'B' ? 'W' : 'B'}+T（对方超时）`;
  }

  snapshot(): RoomView {
    this.checkTimeout();
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
    const res = this.game.play(color, vertex);
    if (!res.ok) throw new RoomError(400, res.message ?? '这一手不能下');
    this.undoRequest = null;
    this.lastMoveAt = Date.now();
  }

  pass(clientId: string): void {
    this.play(clientId, PASS);
    if (this.game.status !== 'playing') {
      const out = this.game.finishByScore([]);
      this.status = 'finished';
      this.result = out.text;
    }
  }

  resign(clientId: string): void {
    const color = this.colorOf(clientId);
    if (color !== 'B' && color !== 'W') throw new RoomError(403, '观众不能认输');
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.result = `${color === 'B' ? '白' : '黑'}中盘胜（对方认输）`;
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
      this.result = '对手离开了房间';
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
