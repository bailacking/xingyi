import { PASS, isValidVertex, type FirstGameExercise, type FirstGameExerciseKind, type GameSnapshot } from '@xingyi/shared';
import { colorCode, type Board, type Group } from './board.js';
import { Game } from './game.js';

interface Opportunity {
  kind: FirstGameExerciseKind;
  stones: number[];
  answer: number;
}

function atariGroups(board: Board): Group[] {
  const seen = new Set<number>();
  const result: Group[] = [];
  for (let v = 0; v < board.grid.length; v++) {
    if (board.at(v) === 0 || seen.has(v)) continue;
    const group = board.groupAt(v);
    for (const stone of group.stones) seen.add(stone);
    if (group.liberties.length === 1) result.push(group);
  }
  return result;
}

function opportunities(game: Game, actual: number): Opportunity[] {
  const color = game.toPlay;
  const result: Opportunity[] = [];
  for (const group of atariGroups(game.board)) {
    const answer = group.liberties[0]!;
    if (answer === actual || !game.isLegal(color, answer)) continue;
    const board = game.board.clone();
    const { captured } = board.place(color, answer);
    const joined = board.groupAt(answer);
    // 只推荐落子后至少有两口气的着法，避开倒扑等复杂变化。
    if (joined.liberties.length < 2) continue;
    const anchor = group.stones[0]!;
    if (game.board.at(anchor) !== colorCode(color)) {
      if (group.stones.every((v) => captured.includes(v))) {
        result.push({ kind: 'capture', stones: group.stones, answer });
      }
    } else if (joined.stones.includes(anchor)) {
      const connects = joined.stones.some((v) => v !== answer && !group.stones.includes(v));
      result.push({ kind: connects ? 'connect' : 'save', stones: group.stones, answer });
    }
  }
  return result;
}

/**
 * 选一处能用实战两手验证后果的局部机会。
 */
export function findFirstGameExercise(
  snapshot: Pick<GameSnapshot, 'size' | 'komi' | 'playerColor' | 'moves' | 'grid'>,
): FirstGameExercise | null {
  const { size, komi, playerColor, moves, grid } = snapshot;
  const game = new Game({ size, komi });
  let best: { option: Opportunity; index: number } | null = null;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]!;
    const reply = moves[i + 1];
    if (move.color !== playerColor || move.vertex === PASS || !reply || reply.vertex === PASS) {
      if (!game.play(move.color, move.vertex).ok) return null;
      continue;
    }
    const options = opportunities(game, move.vertex);
    const played = game.play(move.color, move.vertex);
    if (!played.ok) return null;
    const response = game.play(reply.color, reply.vertex);
    if (!response.ok) return null;
    const index = i;
    i++;
    // 实战同时提到别处的棋时，跳过可能有意为之的交换。
    if (played.captured?.length) continue;
    for (const option of options) {
      const anchor = option.stones[0]!;
      const group = game.board.groupAt(anchor);
      const observed = option.kind === 'capture'
        ? game.board.at(anchor) === colorCode(reply.color)
          && group.stones.includes(reply.vertex)
          && group.liberties.length >= 2
        : option.stones.every((v) => response.captured?.includes(v));
      if (!observed) continue;
      if (!best || option.stones.length > best.option.stones.length
        || (option.stones.length === best.option.stones.length
          && option.kind === 'connect' && best.option.kind !== 'connect')) {
        best = { option, index };
      }
    }
  }

  if (!best || game.board.grid.length !== grid.length || !game.board.grid.every((v, i) => v === grid[i])) return null;
  const copyMove = ({ color, vertex }: GameSnapshot['moves'][number]) => ({ color, vertex });
  return {
    ...best.option,
    size,
    komi,
    prefix: moves.slice(0, best.index).map(copyMove),
    original: [copyMove(moves[best.index]!), copyMove(moves[best.index + 1]!)],
  };
}

export function exercisePosition(exercise: FirstGameExercise): Game {
  const game = new Game({ size: exercise.size, komi: exercise.komi });
  for (const move of exercise.prefix) game.play(move.color, move.vertex);
  return game;
}

export function checkExerciseMove(exercise: FirstGameExercise, vertex: number): { correct: boolean; message: string } {
  if (!isValidVertex(exercise.size, vertex)) return { correct: false, message: '请在棋盘上选一个落点。' };
  const game = exercisePosition(exercise);
  const color = game.toPlay;
  const played = game.play(color, vertex);
  if (!played.ok) return { correct: false, message: `${played.message ?? '这一手不能下'}。再试一个落点。` };
  if (exercise.kind === 'katago') {
    if (vertex === exercise.answer || exercise.comparison?.alternatives.includes(vertex)) {
      return { correct: true, message: vertex === exercise.answer
        ? '这就是 KataGo 推荐的一手。接着看对手可能怎么应。'
        : '这也是 KataGo 评价接近的下法。你可以对照它的首选变化。' };
    }
    return { correct: false, message: vertex === exercise.original[0].vertex
      ? '这是实战落点。试试另一处，或先看推荐点。'
      : '试试 KataGo 标出的候选点，再对照两条变化。' };
  }
  if (exercise.kind === 'capture') {
    if (exercise.stones.every((v) => played.captured?.includes(v)) && game.board.groupAt(vertex).liberties.length >= 2) {
      return { correct: true, message: `你堵住了最后一口气，提走 ${exercise.stones.length} 颗棋子。` };
    }
    return { correct: false, message: '沿着圈出的棋块找最后一口气。试着堵住它，让自己的棋至少有两口气。' };
  }
  const group = game.board.groupAt(exercise.stones[0]!);
  if (group.liberties.length < 2) return { correct: false, message: '这手过后，圈出的棋还只有一口气。试着给它多留一口气。' };
  const joinedExistingStone = group.stones.some((v) => v !== vertex && !exercise.stones.includes(v));
  if (exercise.kind === 'connect' && !joinedExistingStone) {
    return { correct: false, message: '这手让棋块多了气。再试着把它接到附近的同色棋上。' };
  }
  return {
    correct: true,
    message: exercise.kind === 'connect'
      ? `两块同色棋连起来了，现在共用 ${group.liberties.length} 口气。对手下一手提不走它们。`
      : `这块棋现在有 ${group.liberties.length} 口气。对手下一手提不走它。`,
  };
}
