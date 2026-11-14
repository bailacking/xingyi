import type { AnalyzeRequest } from '@xingyi/engine';
import { Game } from '@xingyi/rules';
import {
  PASS, STRONGEST_LEVEL, gtpToVertex, isValidVertex,
  type AnalysisCandidate, type AnalysisResult, type ExerciseMove, type FirstGameExercise, type GameSnapshot,
  type TeachingAttempt,
} from '@xingyi/shared';

const SCAN_LIMIT = 200;
const MIN_GAIN = 1.5;
const DEEP_SEARCH = { visits: 240, minVisits: 80, minDurationMs: 150, maxDurationMs: 1800 };
type Analyze = (request: AnalyzeRequest) => Promise<AnalysisResult | null>;

function position(size: number, komi: number, moves: ExerciseMove[]): Game {
  const game = new Game({ size, komi });
  for (const move of moves) game.play(move.color, move.vertex);
  return game;
}

function continuation(game: Game, candidate: AnalysisCandidate): ExerciseMove[] {
  const moves: ExerciseMove[] = [];
  const pv = candidate.pv.slice(0, 4).map((move) => gtpToVertex(game.size, move));
  const vertices = pv[0] === candidate.vertex ? pv : [candidate.vertex];
  for (const vertex of vertices) {
    if (vertex === PASS) break;
    const color = game.toPlay;
    if (!game.play(color, vertex).ok) break;
    moves.push({ color, vertex });
  }
  return moves;
}

export async function analyzeTeachingAttempt(
  exercise: FirstGameExercise,
  vertex: number,
  analyze: Analyze,
): Promise<TeachingAttempt | null> {
  const { size, komi, prefix, comparison } = exercise;
  if (!comparison) return null;
  const game = position(size, komi, prefix);
  const turn = game.toPlay;
  if (!isValidVertex(size, vertex) || !game.isLegal(turn, vertex)) return null;
  const candidate = (await analyze({
    ...DEEP_SEARCH, size, komi, moves: prefix, turn, level: STRONGEST_LEVEL, intervalMs: 100,
    maxMoves: 1, rootMove: vertex,
  }))?.candidates[0];
  if (!candidate || candidate.vertex !== vertex || candidate.visits < 35 || !Number.isFinite(candidate.scoreLead)) return null;
  // 实战点已用相同预算评过，复用原估值，避免两次采样给同一首着显示不同分数。
  const lead = vertex === exercise.original[0].vertex ? comparison.played : turn === 'B' ? candidate.scoreLead : -candidate.scoreLead;
  return {
    lead,
    closeToSuggested: lead >= comparison.suggested - 0.75,
    variation: continuation(game, candidate),
  };
}

export async function buildTeachingExercise(
  snapshot: GameSnapshot,
  analyze: Analyze,
  report: (done: number, total: number) => void,
): Promise<FirstGameExercise | null> {
  const { size, komi, playerColor } = snapshot;
  const moves = snapshot.moves.map(({ color, vertex }) => ({ color, vertex }));
  const indices = moves.slice(0, SCAN_LIMIT).flatMap((move, i) => move.color === playerColor && move.vertex !== PASS ? [i] : []);
  const total = indices.length;
  if (!total) return null;
  const sign = playerColor === 'B' ? 1 : -1;
  const shortlist: { index: number; estimatedGain: number }[] = [];
  const request = { size, komi, level: STRONGEST_LEVEL, intervalMs: 100 };

  report(0, total);
  let positionsWithAnalysis = 0;
  for (const [step, index] of indices.entries()) {
    const prefix = moves.slice(0, index);
    const original = moves[index]!;
    const before = await analyze({ ...request, moves: prefix, turn: playerColor, visits: 60, minVisits: 12, minDurationMs: 100, maxDurationMs: 600, maxMoves: 3 });
    const best = before?.candidates.find((c) => c.visits > 0 && isValidVertex(size, c.vertex));
    if (before?.candidates.some((c) => c.visits > 0)) positionsWithAnalysis++;
    if (best && best.vertex !== original.vertex) {
      // 低预算扫谱只用于排序，最终差值在同一根局面分别搜索两手。
      const actual = before?.candidates.find((c) => c.vertex === original.vertex && c.visits >= 5);
      const after = actual ? null : await analyze({
        ...request, moves: [...prefix, original], turn: playerColor === 'B' ? 'W' : 'B',
        visits: 60, minVisits: 12, minDurationMs: 100, maxDurationMs: 600, maxMoves: 1,
      });
      const lead = actual?.scoreLead ?? after?.candidates.find((c) => c.visits > 0)?.scoreLead;
      if (lead !== undefined) shortlist.push({ index, estimatedGain: sign * (best.scoreLead - lead) });
    }
    report(step + 1, total);
  }
  if (!positionsWithAnalysis) throw new Error('KataGo 未返回可用分析');

  let bestExercise: FirstGameExercise | null = null;
  let bestGain = MIN_GAIN;
  let attempted = 0;
  let completed = 0;
  for (const { index } of shortlist.sort((a, b) => b.estimatedGain - a.estimatedGain).slice(0, 4)) {
    const prefix = moves.slice(0, index);
    const original = moves[index]!;
    const root = position(size, komi, prefix);
    const deep = { ...request, ...DEEP_SEARCH, moves: prefix, turn: playerColor };
    const candidates = await analyze({ ...deep, maxMoves: 5 });
    const legal = candidates?.candidates.filter((c) => c.visits >= 8 && isValidVertex(size, c.vertex) && root.isLegal(playerColor, c.vertex)) ?? [];
    const preferred = legal[0];
    if (!preferred || preferred.vertex === original.vertex) continue;
    attempted++;
    const actual = (await analyze({ ...deep, maxMoves: 1, rootMove: original.vertex }))?.candidates[0];
    const suggested = (await analyze({ ...deep, maxMoves: 1, rootMove: preferred.vertex }))?.candidates[0];
    if (!actual || !suggested || actual.vertex !== original.vertex || suggested.vertex !== preferred.vertex ||
        actual.visits < 35 || suggested.visits < 35) continue;
    completed++;
    const gain = sign * (suggested.scoreLead - actual.scoreLead);
    if (!Number.isFinite(gain) || gain < bestGain || (gain === bestGain && bestExercise)) continue;
    const variation = continuation(root, suggested);
    if (variation.length < 2) continue;
    const alternatives = legal.filter((c) => c.vertex !== original.vertex && c.vertex !== preferred.vertex &&
      c.visits >= 20 && Math.abs(preferred.scoreLead - c.scoreLead) <= 0.75 &&
      sign * (c.scoreLead - actual.scoreLead) >= MIN_GAIN).map((c) => c.vertex);
    bestGain = gain;
    bestExercise = {
      kind: 'katago', size, komi, prefix, original: [original, ...moves.slice(index + 1, index + 4)],
      stones: [], answer: suggested.vertex,
      comparison: { played: sign * actual.scoreLead, suggested: sign * suggested.scoreLead, variation, alternatives },
    };
  }
  if (attempted && !completed) throw new Error('KataGo 未完成首着对照');
  return bestExercise;
}
