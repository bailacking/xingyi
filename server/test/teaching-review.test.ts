import { describe, expect, it, vi } from 'vitest';
import { checkExerciseMove, Game } from '@xingyi/rules';
import { vertexToGtp, type AnalysisCandidate, type Color, type FirstGameExercise, type GameSnapshot } from '@xingyi/shared';
import type { AnalyzeRequest } from '@xingyi/engine';
import { analyzeTeachingAttempt, buildTeachingExercise } from '../src/teachingReview.js';

function sample(playerColor: Color): GameSnapshot {
  const game = new Game({ size: 9, komi: 7.5 });
  for (const vertex of [40, 48, 30, 50]) game.play(game.toPlay, vertex);
  return {
    id: 'teaching-sample', mode: 'free', size: 9, komi: 7.5, handicap: 0, level: 25,
    playerColor, toPlay: game.toPlay, grid: Array.from(game.board.grid), moves: game.moves,
    lastMove: game.lastMove, captures: game.captures, status: 'finished', createdAt: '', updatedAt: '',
  };
}

function analysis(req: AnalyzeRequest, candidate: AnalysisCandidate[]) {
  return { turn: req.turn, fingerprint: '', rootVisits: 240, candidates: candidate, ownership: null, source: 'katago' as const, elapsedMs: 0 };
}

describe('KataGo 教学复盘', () => {
  it.each(['B', 'W'] as const)('从 %s 方视角在同一局面验证两个落点，保留有效候选和变化', async (color) => {
    const snapshot = sample(color);
    const index = color === 'B' ? 0 : 1;
    const played = snapshot.moves[index]!.vertex;
    const answer = 20;
    const alt = 21;
    const sign = color === 'B' ? 1 : -1;
    const candidate = (vertex: number, scoreLead: number, visits = 120, follow: number[] = [11, 11]) => ({
      move: vertexToGtp(9, vertex), vertex, scoreLead: sign * scoreLead, visits,
      winrate: 0.5, prior: 0.1, order: 0, pv: [vertex, ...follow].map((v) => vertexToGtp(9, v)),
    });
    const run = vi.fn(async (req: AnalyzeRequest) => {
      if (req.moves.length !== index) return analysis(req, []);
      if (req.rootMove !== undefined) {
        return analysis(req, [candidate(req.rootMove, req.rootMove === played ? -4 : 2)]);
      }
      return analysis(req, [candidate(answer, 2), candidate(alt, 1.6, 32), candidate(played, -4)]);
    });
    const progress = vi.fn();
    const exercise = await buildTeachingExercise(snapshot, run, progress);
    expect(exercise).toMatchObject({
      kind: 'katago', answer, comparison: { played: -4, suggested: 2, alternatives: [alt] },
    });
    expect(exercise?.comparison?.variation.map((move) => move.vertex)).toEqual([answer, 11]);
    const forced = run.mock.calls.map(([request]) => request).filter((request) => request.rootMove !== undefined);
    expect(forced.map((request) => request.rootMove)).toEqual([played, answer]);
    expect(forced[0]?.moves).toEqual(forced[1]?.moves);
    expect(forced.every((request) => request.turn === color)).toBe(true);
    expect(checkExerciseMove(exercise!, alt).correct).toBe(true);
    expect(checkExerciseMove(exercise!, played).correct).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it('最佳候选和实战相同就不给出题目', async () => {
    const snapshot = sample('B');
    const result = await buildTeachingExercise(snapshot, async (req) => {
      const vertex = snapshot.moves[req.moves.length]!.vertex;
      return analysis(req, [{ move: vertexToGtp(9, vertex), vertex, scoreLead: 0, visits: 120, winrate: 0.5, prior: 0.5, order: 0, pv: [] }]);
    }, () => undefined);
    expect(result).toBeNull();
  });

  it('白方可试未列出的合法落点，按白方目差判断并验证后续手数', async () => {
    const snapshot = sample('W');
    const exercise: FirstGameExercise = {
      kind: 'katago', size: 9, komi: 7.5, prefix: snapshot.moves.slice(0, 1),
      original: [{ color: 'W', vertex: 22 }], stones: [], answer: 20,
      comparison: { played: -4, suggested: 2, variation: [], alternatives: [] },
    };
    const run = vi.fn(async (req: AnalyzeRequest) => analysis(req, [{
      move: 'D7', vertex: 21, visits: 120, scoreLead: -1.7, winrate: 0.5, order: 0, prior: 0.1,
      pv: ['D7', 'C7', 'C7'],
    }]));
    expect(await analyzeTeachingAttempt(exercise, 40, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(await analyzeTeachingAttempt(exercise, 21, run)).toEqual({
      lead: 1.7, closeToSuggested: true, variation: [{ color: 'W', vertex: 21 }, { color: 'B', vertex: 20 }],
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ rootMove: 21, turn: 'W', moves: exercise.prefix }));
    expect(await analyzeTeachingAttempt(exercise, 23, run)).toBeNull();
    const original = await analyzeTeachingAttempt(exercise, 22, async (req) => analysis(req, [{
      move: 'E7', vertex: 22, visits: 120, scoreLead: -1.7, winrate: 0.5, order: 0, prior: 0.1,
      pv: ['E7', 'C7'],
    }]));
    expect(original).toMatchObject({ lead: -4, closeToSuggested: false });
  });
});
