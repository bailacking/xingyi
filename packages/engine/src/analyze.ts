import type { AnalysisCandidate, Color } from '@xingyi/shared';
import { gtpToVertex } from '@xingyi/shared';

/** info 段内的字段名（KataGo 可能新增字段，解析必须容错）。 */
const INFO_FIELDS = new Set([
  'move',
  'visits',
  'edgeVisits',
  'utility',
  'winrate',
  'scoreMean',
  'scoreStdev',
  'scoreLead',
  'scoreSelfplay',
  'prior',
  'noResultValue',
  'utilityLcb',
  'weight',
  'lcb',
  'order',
  'pv',
  'pvVisits',
  'pvEdgeVisits',
  'isSymmetryOf',
]);

export interface ParsedAnalyzeLine {
  /** 一行里可能有多个 info 段（实测：一次输出把 5~6 个候选串在同一行） */
  candidates: AnalysisCandidate[];
  /** 根的访问数（rootInfo 段） */
  rootVisits?: number;
  /** 逐点归属，[-1,1]，视角 = 行棋方 */
  ownership?: number[];
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 解析一行 `kata-analyze` 输出。
 *
 * 真实格式（KataGo v1.18.2 实测）是**一行里串多个段**：
 *   `info move Q4 visits 3 ... info move D4 visits 3 ... rootInfo visits 500 ... ownership 0.1 0.2 ...`
 * 只按"一行一个候选"解析会一个都拿不到——所以按段切分，返回候选数组。
 * 字段顺序不保证，新字段一律忽略。
 */
export function parseAnalyzeLine(line: string, size: number): ParsedAnalyzeLine {
  const tokens = line.trim().split(/\s+/);
  const candidates: AnalysisCandidate[] = [];
  let rootVisits: number | undefined;
  let ownership: number[] | undefined;

  let section: 'info' | 'root' | null = null;
  let fields: Record<string, string> = {};
  let pv: string[] = [];

  const flush = (): void => {
    if (section === 'info') {
      const move = fields.move ?? '';
      if (move) {
        candidates.push({
          move,
          vertex: gtpToVertex(size, move),
          visits: num(fields.visits),
          winrate: num(fields.winrate),
          scoreLead: num(fields.scoreLead),
          prior: num(fields.prior),
          order: num(fields.order),
          pv,
        });
      }
    } else if (section === 'root') {
      if (fields.visits) rootVisits = num(fields.visits);
    }
    fields = {};
    pv = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === 'info' || t === 'rootInfo') {
      flush();
      section = t === 'info' ? 'info' : 'root';
      continue;
    }
    if (t === 'ownership' || t === 'ownershipStdev') {
      if (t === 'ownership') {
        const vals: number[] = [];
        for (let j = i + 1; j < tokens.length; j++) {
          const n = Number(tokens[j]);
          if (Number.isFinite(n)) vals.push(n);
          else break;
        }
        ownership = vals;
      }
      break; // ownership 是最后一个顶层段，后面不用看了
    }
    if (!section) continue;
    if (!INFO_FIELDS.has(t)) continue;

    if (t === 'pv') {
      pv = [];
      let j = i + 1;
      while (j < tokens.length) {
        const tok = tokens[j]!;
        // 坐标一定带数字（pass 除外）；纯字母 token 视为新段/新字段
        if (tok === 'info' || tok === 'rootInfo' || tok === 'ownership') break;
        if (tok !== 'pass' && /^[A-Za-z_]+$/.test(tok)) break;
        pv.push(tok);
        j++;
      }
      i = j - 1;
      continue;
    }
    fields[t] = tokens[i + 1] ?? '';
    i += 1;
  }
  flush();

  return { candidates, rootVisits, ownership };
}

/** ownership 是"行棋方视角"，转成黑正白负，供形势图使用。 */
export function ownershipToBlack(ownership: number[] | undefined, turn: Color): number[] | null {
  if (!ownership || ownership.length === 0) return null;
  return turn === 'B' ? ownership : ownership.map((v) => -v);
}

export interface AnalyzeAccumulator {
  size: number;
  turn: Color;
  candidates: Map<string, AnalysisCandidate>;
  rootVisits: number;
  ownership: number[] | null;
}

export function createAccumulator(size: number, turn: Color): AnalyzeAccumulator {
  return { size, turn, candidates: new Map(), rootVisits: 0, ownership: null };
}

export function feedLine(acc: AnalyzeAccumulator, line: string): void {
  if (!line) return;
  const parsed = parseAnalyzeLine(line, acc.size);
  if (parsed.ownership && parsed.ownership.length === acc.size * acc.size) {
    acc.ownership = ownershipToBlack(parsed.ownership, acc.turn);
  }
  if (parsed.rootVisits) acc.rootVisits = parsed.rootVisits;
  for (const cand of parsed.candidates) {
    const prev = acc.candidates.get(cand.move);
    // 同一个候选会反复输出，取访问数更多的那份
    if (!prev || cand.visits >= prev.visits) acc.candidates.set(cand.move, cand);
  }
}

export function finalizeCandidates(acc: AnalyzeAccumulator, maxMoves: number): AnalysisCandidate[] {
  return [...acc.candidates.values()]
    .sort((a, b) => a.order - b.order || b.visits - a.visits)
    .slice(0, maxMoves);
}
