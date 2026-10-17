import type { AnalysisCandidate, Color } from '@xingyi/shared';
import { gtpToVertex } from '@xingyi/shared';

/** 顶层字段与 info 内字段（KataGo 可能新增字段，解析必须容错）。 */
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
  kind: 'info' | 'root' | 'other';
  candidate?: AnalysisCandidate;
  /** 根的访问数（rootInfo 行） */
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
 * 格式依据 docs/GTP_Extensions.md：字段顺序不保证，新字段可能出现，未知字段一律忽略。
 */
export function parseAnalyzeLine(line: string, size: number): ParsedAnalyzeLine {
  const tokens = line.trim().split(/\s+/);
  let kind: 'info' | 'root' | 'other' = 'other';
  const fields: Record<string, string> = {};
  let pv: string[] = [];
  let ownership: number[] | null = null;

  const flush = (): void => {};
  let current = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === 'info' || t === 'rootInfo') {
      kind = t === 'info' ? 'info' : 'root';
      current = '';
      continue;
    }
    if (t === 'ownership' || t === 'ownershipStdev') {
      const vals: number[] = [];
      for (let j = i + 1; j < tokens.length; j++) {
        const n = Number(tokens[j]);
        if (Number.isFinite(n)) vals.push(n);
        else break;
      }
      if (t === 'ownership') ownership = vals;
      break;
    }
    if (kind === 'other') continue;
    if (INFO_FIELDS.has(t) || (kind === 'root' && (t === 'visits' || t === 'winrate' || t === 'scoreLead'))) {
      current = t;
      if (t === 'pv') {
        pv = [];
        let j = i + 1;
        while (j < tokens.length) {
          const tok = tokens[j]!;
          // 坐标一定带数字（pass 除外）；纯字母 token 视为新字段名 → PV 结束。
          const looksLikeField = tok !== 'pass' && /^[A-Za-z_][A-Za-z_]*$/.test(tok);
          if (INFO_FIELDS.has(tok) || tok === 'ownership' || tok === 'rootInfo' || tok === 'info' || looksLikeField) break;
          pv.push(tok);
          j++;
        }
        i = j - 1;
        fields.pv = pv.join(' ');
        current = '';
      } else {
        fields[t] = tokens[i + 1] ?? '';
        i += 1;
      }
      continue;
    }
    // 未知 token：忽略（可能是新字段名）
  }
  flush();

  if (kind === 'root') {
    return { kind, rootVisits: num(fields.visits), ownership: ownership ?? undefined };
  }
  if (kind === 'info') {
    const move = fields.move ?? '';
    const candidate: AnalysisCandidate = {
      move,
      vertex: gtpToVertex(size, move),
      visits: num(fields.visits),
      winrate: num(fields.winrate),
      scoreLead: num(fields.scoreLead),
      prior: num(fields.prior),
      order: num(fields.order),
      pv,
    };
    return { kind, candidate, ownership: ownership ?? undefined };
  }
  return { kind, ownership: ownership ?? undefined };
}

/** ownership 是"行棋方视角"，转成黑正白负，供形势图使用。 */
export function ownershipToBlack(ownership: number[] | undefined, turn: Color): number[] | null {
  if (!ownership || ownership.length === 0) return null;
  return turn === 'B' ? ownership.map((v) => v) : ownership.map((v) => -v);
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
  if (parsed.kind === 'root' && parsed.rootVisits) acc.rootVisits = parsed.rootVisits;
  if (parsed.kind === 'info' && parsed.candidate) {
    acc.candidates.set(parsed.candidate.move, parsed.candidate);
  }
}

export function finalizeCandidates(acc: AnalyzeAccumulator, maxMoves: number): AnalysisCandidate[] {
  return [...acc.candidates.values()]
    .sort((a, b) => a.order - b.order || b.visits - a.visits)
    .slice(0, maxMoves);
}
