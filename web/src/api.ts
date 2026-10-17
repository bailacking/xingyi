import { useEffect, useRef, useState } from 'react';
import type {
  AnalysisResult,
  AppConfigLike,
  EngineStatus,
  GameSnapshot,
  HardwareReport,
  Mode,
  ProgressView,
  ReviewResult,
  Settlement,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // 没有 body 的 POST 不能带 content-type: application/json，否则 Fastify 会判「空 JSON body」
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const raw = data as { error?: unknown } | null;
    const message =
      raw && typeof raw === 'object' && typeof raw.error === 'string' ? raw.error : `请求失败（${res.status}）`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export interface Bootstrap {
  version: string;
  config: AppConfigLike;
  engine: EngineStatus;
  progress: ProgressView;
  ranks: { maxLevel: number; calibrated: boolean; step?: number | null; stepCi95?: [number, number] | null; note?: string | null };
  modes: Record<Mode, Record<string, boolean>>;
  engineConfigured: boolean;
}

export interface GameResponse {
  snapshot: GameSnapshot;
  settlement: Settlement | null;
  opponent?: 'katago' | 'offline' | 'human';
  isPlacement?: boolean;
  examLevel?: number | null;
  variations?: number;
  warnings?: string[];
}

export type AnalyzeResponse = { available: true; result: AnalysisResult } | { available: false; reason: string };

export const api = {
  bootstrap: () => req<Bootstrap>('/api/bootstrap'),
  saveConfig: (patch: unknown) => req<{ config: AppConfigLike }>('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),
  probe: () => req<HardwareReport>('/api/engine/probe', { method: 'POST' }),
  check: () =>
    req<{
      ok: boolean;
      steps: { key: string; label: string; ok: boolean; message: string }[];
      version: string | null;
      models: string[];
      humanSL: boolean;
    }>('/api/engine/check', { method: 'POST' }),
  restartEngine: () => req<EngineStatus>('/api/engine/restart', { method: 'POST' }),
  newGame: (opts: {
    mode: Mode;
    size?: number;
    komi?: number;
    level?: number;
    playerColor?: 'B' | 'W';
    examLevel?: number | null;
  }) => req<GameResponse>('/api/game', { method: 'POST', body: JSON.stringify(opts) }),
  getGame: (id: string) => req<GameResponse>(`/api/game/${id}`),
  move: (id: string, vertex: number) =>
    req<GameResponse>(`/api/game/${id}/move`, { method: 'POST', body: JSON.stringify({ vertex }) }),
  pass: (id: string) => req<GameResponse>(`/api/game/${id}/pass`, { method: 'POST' }),
  redo: (id: string) => req<GameResponse>(`/api/game/${id}/redo`, { method: 'POST' }),
  undo: (id: string, to?: number) =>
    req<GameResponse>(`/api/game/${id}/undo`, { method: 'POST', body: JSON.stringify(to === undefined ? {} : { to }) }),
  endGame: (id: string) => req<GameResponse>(`/api/game/${id}/end`, { method: 'POST' }),
  resign: (id: string) => req<GameResponse>(`/api/game/${id}/resign`, { method: 'POST' }),
  quit: (id: string) => req<GameResponse>(`/api/game/${id}/quit`, { method: 'POST' }),
  score: (id: string, dead: number[]) =>
    req<{
      blackArea: number;
      whiteArea: number;
      komi: number;
      diff: number;
      winner: 'B' | 'W' | null;
      margin: number;
      blackTerritory: number[];
      whiteTerritory: number[];
    }>(`/api/game/${id}/score`, { method: 'POST', body: JSON.stringify({ dead }) }),
  finish: (id: string, dead: number[]) =>
    req<GameResponse>(`/api/game/${id}/finish`, { method: 'POST', body: JSON.stringify({ dead }) }),
  review: (id: string) =>
    req<{ available: true; result: ReviewResult } | { available: false; reason: string }>(`/api/game/${id}/review`, {
      method: 'POST',
    }),
  analyze: (id: string, depth?: string, assumeLevel?: number | null) =>
    req<AnalyzeResponse>(`/api/game/${id}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ depth, assumeLevel }),
    }),
  newSetupGame: (p: { size: 9 | 13 | 19; grid: number[]; toPlay?: 'B' | 'W'; komi?: number }) =>
    req<GameResponse>('/api/game/setup', { method: 'POST', body: JSON.stringify(p) }),
  importSgf: (text: string) =>
    req<GameResponse>('/api/sgf/import', { method: 'POST', body: JSON.stringify({ text }) }),
  sgfUrl: (id: string) => `/api/game/${id}/sgf`,
  progress: () => req<ProgressView>('/api/progress'),
  simulateRanked: (pattern: 'win' | 'alternate' | 'lose', games = 10, startLevel?: number) =>
    req<{
      start: { level: number; R: number; RD: number };
      timeline: { game: number; won: boolean; R: number; deltaR: number; level: number; change: 'up' | 'down' | null; pending: boolean }[];
      end: { level: number; R: number; RD: number; levelCn: string };
    }>('/api/simulate/ranked', {
      method: 'POST',
      body: JSON.stringify({ pattern, games, startLevel }),
    }),
  rename: (name: string) =>
    req<ProgressView>('/api/progress/name', { method: 'POST', body: JSON.stringify({ name }) }),
};

export interface SocketEvent {
  type: 'hello' | 'game' | 'engine' | 'progress' | 'error';
  data: unknown;
}

/** 单例 WS 订阅：断线自动重连（本地服务重启时前端不用刷新）。 */
export function useSocket(onEvent: (e: SocketEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          handler.current(JSON.parse(ev.data as string) as SocketEvent);
        } catch {
          /* 忽略坏消息 */
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { connected };
}
