import fs from 'node:fs';
import path from 'node:path';
import { Game } from '@xingyi/rules';
import { DEFAULT_KOMI, vertexToGtp, type BoardSize, type Color, type Vertex } from '@xingyi/shared';
import { ServiceError } from './gameService.js';
import { dataPaths } from './paths.js';

/**
 * 定式练习（W1）。
 *
 * 数据是 `data/joseki/index.json`，形如
 *   { joseki: [{ id, title, size, category, steps: [{ color, vertex }], note }] }
 *
 * 约定：
 * - 坐标用 `y * size + x`（与盘面 grid 下标一致），提示时才换成 GTP（Q16）。
 * - **每一步都过规则引擎**：判手前把前 step 手重放一遍，走错时顺便用 `preview()` 说清
 *   「这手为什么不能下」，而不是手写一堆特例判断（AGENTS.md §6 I4）。
 * - 数据坏了不许静默：读不到 → 列表为空；能读到但序列不合法 → 500 + 中文原因，
 *   宁可让测试红，也不要在界面上教错棋。
 */

export interface JosekiStep {
  color: Color;
  vertex: Vertex;
}

export interface JosekiEntry {
  id: string;
  title: string;
  size: BoardSize;
  category: string;
  steps: JosekiStep[];
  note: string;
}

/** 列表项：只给「有几手、什么类别」，不含答案坐标。 */
export interface JosekiSummary {
  id: string;
  title: string;
  category: string;
  size: BoardSize;
  moves: number;
}

/** 详情：同样不含答案，只给每手的先后手，前端据此决定该谁下、画谁的子。 */
export interface JosekiView {
  id: string;
  title: string;
  size: BoardSize;
  category: string;
  note: string;
  total: number;
  colors: Color[];
}

export interface JosekiCheckResult {
  correct: boolean;
  /** 走错时给出该下哪一手（GTP 坐标），供「第 N 手应下 Q16」提示用 */
  expected?: string;
  done: boolean;
  step: number;
  total: number;
  message: string;
}

const SIZES: BoardSize[] = [9, 13, 19];

const cache = new Map<string, { mtimeMs: number; list: JosekiEntry[] }>();

function isColor(v: unknown): v is Color {
  return v === 'B' || v === 'W';
}

function toEntry(raw: unknown): JosekiEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const size = r.size as BoardSize;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.title !== 'string' || !r.title) return null;
  if (!SIZES.includes(size)) return null;
  if (!Array.isArray(r.steps) || r.steps.length === 0) return null;
  const steps: JosekiStep[] = [];
  for (const s of r.steps as unknown[]) {
    if (!s || typeof s !== 'object') return null;
    const step = s as Record<string, unknown>;
    if (!isColor(step.color)) return null;
    if (typeof step.vertex !== 'number' || !Number.isInteger(step.vertex)) return null;
    if (step.vertex < 0 || step.vertex >= size * size) return null;
    steps.push({ color: step.color, vertex: step.vertex });
  }
  return {
    id: r.id,
    title: r.title,
    size,
    category: typeof r.category === 'string' && r.category ? r.category : '未分类',
    steps,
    note: typeof r.note === 'string' ? r.note : '',
  };
}

/** 读定式表（按 mtime 缓存；文件坏了返回空表，不炸服务）。 */
export function loadJoseki(dir: string = dataPaths().data): JosekiEntry[] {
  const file = path.join(dir, 'joseki', 'index.json');
  try {
    const stat = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.list;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { joseki?: unknown };
    const list = (Array.isArray(raw.joseki) ? raw.joseki : [])
      .map(toEntry)
      .filter((e): e is JosekiEntry => e !== null);
    cache.set(file, { mtimeMs: stat.mtimeMs, list });
    return list;
  } catch {
    return [];
  }
}

export function listJoseki(dir?: string): JosekiSummary[] {
  return loadJoseki(dir).map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    size: e.size,
    moves: e.steps.length,
  }));
}

function requireJoseki(id: string, dir?: string): JosekiEntry {
  const entry = loadJoseki(dir).find((e) => e.id === id);
  if (!entry) throw new ServiceError(404, '没有这个定式');
  return entry;
}

export function getJoseki(id: string, dir?: string): JosekiView {
  const e = requireJoseki(id, dir);
  return {
    id: e.id,
    title: e.title,
    size: e.size,
    category: e.category,
    note: e.note,
    total: e.steps.length,
    colors: e.steps.map((s) => s.color),
  };
}

/** 重放到第 step 手之前（0 = 空盘）。数据不合法直接报 500，不猜。 */
function positionBefore(entry: JosekiEntry, step: number): Game {
  const game = new Game({ size: entry.size, komi: DEFAULT_KOMI });
  for (let i = 0; i < step; i++) {
    const s = entry.steps[i];
    const res = game.play(s.color, s.vertex);
    if (!res.ok) {
      throw new ServiceError(
        500,
        `定式数据有误：${entry.id} 第 ${i + 1} 手 ${vertexToGtp(entry.size, s.vertex)} 不合法（${res.message ?? '未知原因'}）`,
      );
    }
  }
  return game;
}

/**
 * 判一手。
 * - 走对：correct，done 表示整条序列走完；
 * - 走错：correct=false + expected（GTP），message 里带「第 N 手应下 X」。
 */
export function checkJoseki(id: string, step: number, vertex: number, dir?: string): JosekiCheckResult {
  const entry = requireJoseki(id, dir);
  const total = entry.steps.length;
  if (!Number.isInteger(step) || step < 0 || step >= total) {
    throw new ServiceError(400, `手数不对：这个定式一共 ${total} 手，step 从 0 开始`);
  }
  if (!Number.isInteger(vertex) || vertex < 0 || vertex >= entry.size * entry.size) {
    throw new ServiceError(400, '落点不在棋盘上');
  }

  const target = entry.steps[step];
  const expected = vertexToGtp(entry.size, target.vertex);

  if (vertex === target.vertex) {
    const done = step === total - 1;
    return {
      correct: true,
      done,
      step,
      total,
      message: done ? `${entry.title}：这一路走完了` : `对，第 ${step + 1} 手就下这里`,
    };
  }

  // 走错了：用规则引擎解释这手为什么不行（已有子 / 自杀 / 劫），再补正确的坐标
  const probe = positionBefore(entry, step).preview(target.color, vertex);
  const why = probe.ok ? `第 ${step + 1} 手不该下这里` : (probe.message ?? '这一手不能下');
  return {
    correct: false,
    expected,
    done: false,
    step,
    total,
    message: `${why}；第 ${step + 1} 手应下 ${expected}`,
  };
}

/** 自检：返回问题列表（空数组 = 这条序列逐手合法，且落完没有零气棋块）。测试与数据手改时用。 */
export function validateJoseki(entry: JosekiEntry): string[] {
  const issues: string[] = [];
  const game = new Game({ size: entry.size, komi: DEFAULT_KOMI });
  entry.steps.forEach((s, i) => {
    const res = game.play(s.color, s.vertex);
    if (!res.ok) {
      issues.push(`第 ${i + 1} 手 ${s.color} ${vertexToGtp(entry.size, s.vertex)} 被规则拒绝：${res.message ?? res.error}`);
    }
  });
  for (let v = 0; v < entry.size * entry.size; v++) {
    if (game.board.at(v) !== 0 && game.board.groupAt(v).liberties.length === 0) {
      issues.push('落子后出现零气棋块');
      break;
    }
  }
  return issues;
}
