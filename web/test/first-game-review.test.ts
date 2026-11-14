import { describe, expect, it } from 'vitest';
import { Game, BLACK, EMPTY, checkExerciseMove, exercisePosition, findFirstGameExercise } from '@xingyi/rules';
import { PASS, type Color, type GameSnapshot } from '@xingyi/shared';

const at = (x: number, y: number) => y * 9 + x;

function gameFrom(vertices: number[], playerColor: Color = 'B'): Pick<GameSnapshot, 'size' | 'komi' | 'moves' | 'grid' | 'playerColor'> {
  const game = new Game({ size: 9, komi: 7.5 });
  for (const vertex of vertices) {
    const move = game.play(game.toPlay, vertex);
    expect(move.ok, move.message).toBe(true);
  }
  return { size: 9, komi: game.komi, moves: game.moves, grid: Array.from(game.board.grid), playerColor };
}

describe('第一盘复盘', () => {
  it('从实战找出被提的黑棋，重下一手后黑棋不再被打吃', () => {
    const stone = at(0, 0);
    const escape = at(0, 1);
    const game = gameFrom([stone, at(1, 0), at(8, 8), escape, PASS, PASS]);
    const lesson = findFirstGameExercise(game)!;
    expect(lesson).toMatchObject({ kind: 'save', answer: escape, stones: [stone] });
    const board = exercisePosition(lesson);
    expect(board.board.groupAt(stone).liberties).toEqual([escape]);
    expect(board.toPlay).toBe('B');
    expect(checkExerciseMove(lesson, at(8, 8)).correct).toBe(false);
    expect(checkExerciseMove(lesson, stone).correct).toBe(false);
    expect(checkExerciseMove(lesson, escape)).toMatchObject({ correct: true, message: expect.stringContaining('2 口气') });
    for (const move of lesson.original) board.play(move.color, move.vertex);
    expect(board.board.at(stone)).toBe(EMPTY);
    expect(game.moves).toHaveLength(6);
  });

  it('从实战找出错过的提子，原着回放显示对方接出', () => {
    const stone = at(0, 0);
    const escape = at(0, 1);
    const lesson = findFirstGameExercise(gameFrom([at(1, 0), stone, at(8, 8), escape]))!;
    expect(lesson).toMatchObject({ kind: 'capture', answer: escape, stones: [stone] });
    expect(checkExerciseMove(lesson, escape)).toMatchObject({ correct: true, message: expect.stringContaining('提走 1 颗棋子') });
    const board = exercisePosition(lesson);
    for (const move of lesson.original) board.play(move.color, move.vertex);
    expect(board.board.groupAt(stone).liberties.length).toBeGreaterThan(1);
  });

  it('推荐一手连回原本分开的同色棋，演示中的气数来自规则层', () => {
    const stone = at(0, 0);
    const neighbor = at(0, 2);
    const join = at(0, 1);
    const lesson = findFirstGameExercise(gameFrom([stone, at(1, 0), neighbor, at(8, 8), at(7, 8), join]))!;
    expect(lesson).toMatchObject({ kind: 'connect', answer: join, stones: [stone] });
    expect(checkExerciseMove(lesson, join)).toMatchObject({ correct: true, message: expect.stringContaining('3 口气') });
    const board = exercisePosition(lesson);
    expect(board.board.at(neighbor)).toBe(BLACK);
    board.play(board.toPlay, join);
    expect(board.board.groupAt(stone).stones).toContain(neighbor);
  });

  it('白棋复盘保留原盘的轮次，无法立即提劫', () => {
    const beforeKo = [at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(1, 2), at(3, 1), at(8, 8), at(2, 2), at(2, 1)];
    const game = gameFrom([...beforeKo, at(8, 0), at(8, 1)], 'W');
    const earlier = findFirstGameExercise(game)!;
    expect(earlier.prefix).toHaveLength(7);
    expect(checkExerciseMove(earlier, earlier.answer).correct).toBe(true);
    const board = exercisePosition({
      kind: 'capture', size: 9, komi: 7.5, prefix: game.moves.slice(0, 9),
      original: [game.moves[9]!, game.moves[10]!], stones: [at(2, 1)], answer: at(1, 1),
    });
    expect(board.toPlay).toBe('W');
    expect(board.preview('W', at(1, 1)).error).toBe('superko');
  });

  it('没发生适合讲解的后续就返回空，也拒绝与棋谱不符的终盘', () => {
    expect(findFirstGameExercise(gameFrom([at(2, 2), at(6, 6), PASS, PASS]))).toBeNull();
    expect(findFirstGameExercise(gameFrom([at(0, 0), at(1, 0), at(8, 8), at(6, 6)]))).toBeNull();
    const game = gameFrom([at(0, 0), at(1, 0), at(8, 8), at(0, 1)]);
    game.grid[at(4, 4)] = BLACK;
    expect(findFirstGameExercise(game)).toBeNull();
  });
});
