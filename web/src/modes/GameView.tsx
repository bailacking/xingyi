import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BEGINNER_LEVEL, STRONGEST_LEVEL, gtpToVertex, type TeachingReviewStatus } from '@xingyi/shared';
import { Board as RulesBoard, Game } from '@xingyi/rules';
import { Board } from '../board/Board';
import { FirstGameReviewView } from './FirstGameReviewView';
import { api, ApiError, type Bootstrap, type GameResponse, type SocketEvent } from '../api';
import { AnalysisPanel } from '../panels/AnalysisPanel';
import { MoveList } from '../panels/MoveList';
import { ReviewPanel } from '../panels/ReviewPanel';
import { playBell, playStone } from '../sound';
import { Seal } from '../theme/Seal';
import {
  CAPS,
  CAP_NOTES,
  MODE_NAMES,
  PASS,
  levelCn,
  levelCnFormal,
  type AnalysisCandidate,
  type AnalysisResult,
  type GameSnapshot,
  type Mode,
  type ReviewResult,
} from '../types';
import type { Settlement } from '../types';

interface GameViewProps {
  mode: Mode;
  bootstrap: Bootstrap;
  lastEvent: SocketEvent | null;
  initialGame?: GameResponse;
  fromLesson?: boolean;
  onEngineSettings?: () => void;
  onBack: () => void;
}

const cnNumber = (n: number): string => levelCn(Math.abs(n)).replace('级', '');

/** 时间制预设（与服务端 server/src/clock.ts 的 TIME_PRESETS 对齐，改一处要改两处） */
type TimePresetId = 'none' | '10m' | '5m' | 'blitz';
const TIME_PRESETS: { id: TimePresetId; name: string; control: { mainSec: number; byoYomiSec: number; periods: number } | null }[] = [
  { id: 'none', name: '不限时', control: null },
  { id: '10m', name: '10 分 + 3×30 秒', control: { mainSec: 600, byoYomiSec: 30, periods: 3 } },
  { id: '5m', name: '5 分 + 3×30 秒', control: { mainSec: 300, byoYomiSec: 30, periods: 3 } },
  { id: 'blitz', name: '3 分包干', control: { mainSec: 180, byoYomiSec: 0, periods: 0 } },
];

/** 新对局的全部可调项（改任意一项都要重新开局才生效） */
interface Setup {
  size: 9 | 13 | 19;
  level: number;
  playerColor: 'B' | 'W';
  handicap: number;
  timePreset: TimePresetId;
}

const fmtClock = (ms: number): string => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
};

export function GameView({ mode, bootstrap, lastEvent, initialGame, fromLesson = false, onBack, onEngineSettings }: GameViewProps) {
  const caps = CAPS[mode];
  const [game, setGame] = useState<GameSnapshot | null>(initialGame?.snapshot ?? null);
  const [opponent, setOpponent] = useState<'katago' | 'offline' | 'human'>(initialGame?.opponent ?? 'offline');
  const [placementStage, setPlacementStage] = useState<number | null>(initialGame?.placementStage ?? null);
  const [settlement, setSettlement] = useState<Settlement | null>(initialGame?.settlement ?? null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisReason, setAnalysisReason] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [hoverPv, setHoverPv] = useState<AnalysisCandidate | null>(null);
  const [showOwnership, setShowOwnership] = useState(bootstrap.config.ui.showOwnership);
  const [deadStones, setDeadStones] = useState<number[]>([]);
  const [scorePreview, setScorePreview] = useState<{
    blackArea: number;
    whiteArea: number;
    komi: number;
    diff: number;
    winner: 'B' | 'W' | null;
    margin: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<'game' | 'analysis' | 'moves'>('game');
  const [review, setReview] = useState<{ result: ReviewResult; ply: number } | null>(null);
  const [showFirstGameReview, setShowFirstGameReview] = useState(false);
  const [teaching, setTeaching] = useState<TeachingReviewStatus | null>(null);
  const [startingTeaching, setStartingTeaching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editGrid, setEditGrid] = useState<number[] | null>(null);
  const [palette, setPalette] = useState<'B' | 'W' | 'E'>('B');
  const [editToPlay, setEditToPlay] = useState<'B' | 'W'>('B');
  const [assumeDelta, setAssumeDelta] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  /** 「中断复盘」标记：置 true 后，下一轮请求先喊停再收最终快照 */
  const reviewCancelled = useRef(false);
  const reviewDismissed = useRef(false);
  const [setup, setSetup] = useState<Setup>({
    size: fromLesson ? 9 : bootstrap.config.game.boardSize,
    level: fromLesson ? BEGINNER_LEVEL : bootstrap.progress.maxLevel,
    playerColor: fromLesson ? 'B' : bootstrap.config.ui.playerColor,
    handicap: 0,
    timePreset: fromLesson ? 'none' : '10m',
  });

  const setupDetails = useRef<HTMLDetailsElement>(null);
  const sgfInput = useRef<HTMLInputElement>(null);
  const baseLevel = game?.level ?? setup.level;
  const assume = assumeDelta === 0 ? null : Math.min(bootstrap.progress.maxLevel, Math.max(STRONGEST_LEVEL, baseLevel - assumeDelta));

  const gameRef = useRef<GameSnapshot | null>(null);
  gameRef.current = game;

  // 落子音：只认"盘面多了一颗子"，不管是人下的还是 WS 推来的（撤子不响）
  const prevSnap = useRef<GameSnapshot | null>(null);
  useEffect(() => {
    const prev = prevSnap.current;
    prevSnap.current = game;
    if (!game || !prev || prev.id !== game.id) return;
    const count = (g: GameSnapshot): number => g.grid.reduce((a, b) => a + (b ? 1 : 0), 0);
    const added = count(game) - count(prev);
    const capDelta = game.captures.B + game.captures.W - (prev.captures.B + prev.captures.W);
    if (added > 0) playStone(capDelta > 0);
  }, [game]);

  const applyResponse = useCallback((res: GameResponse) => {
    gameRef.current = res.snapshot;
    setGame(res.snapshot);
    if (res.opponent) setOpponent(res.opponent);
    if (res.placementStage !== undefined) setPlacementStage(res.placementStage);
    if (res.settlement) setSettlement(res.settlement);
    if (res.warnings?.length) setError(res.warnings.join(' / '));
  }, []);

  const startGame = useCallback(
    async (examLevel?: number | null) => {
      const next = setup;
      setBusy(true);
      setError(null);
      setSettlement(null);
      setPane('game');
      setAnalysis(null);
      setHoverPv(null);
      setAnalysisReason(null);
      setDeadStones([]);
      setScorePreview(null);
      reviewDismissed.current = true;
      setReview(null);
      setShowFirstGameReview(false);
      setTeaching(null);
      setReviewing(false);
      // 切局要退出摆棋，否则编辑盘面会和棋盘尺寸对不上
      setEditing(false);
      setEditGrid(null);
      try {
        const res = await api.newGame(
          mode === 'ranked'
            ? { mode, examLevel: examLevel ?? null, saveId: bootstrap.progress.activeSaveId }
            : {
                mode,
                size: next.size,
                level: next.level,
                playerColor: next.playerColor,
                komi: 7.5,
                handicap: next.handicap,
                timeControl: TIME_PRESETS.find((t) => t.id === next.timePreset)?.control ?? null,
                ...(fromLesson ? { fromLesson: true } : {}),
              },
        );
        applyResponse(res);
        if (setupDetails.current) setupDetails.current.open = false;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '开局失败');
      } finally {
        setBusy(false);
      }
    },
    [applyResponse, mode, bootstrap.progress.activeSaveId, fromLesson, setup],
  );

  const startReview = useCallback(async () => {
    const g = gameRef.current;
    if (!g) return;
    reviewCancelled.current = false;
    reviewDismissed.current = false;
    setReviewing(true);
    setError(null);
    try {
      // 复盘是分块算的：每叫一次多拿一块（约 2.4 秒），progress.running 为 false 才算完。
      // 不想等就点「中断」，下一轮先喊停再取最终快照。
      for (;;) {
        if (reviewCancelled.current) await api.reviewCancel(g.id).catch(() => undefined);
        const res = await api.review(g.id);
        if (reviewDismissed.current) {
          if (res.available && res.result.progress?.running) await api.reviewCancel(g.id).catch(() => undefined);
          break;
        }
        if (!res.available) {
          setError(res.reason);
          break;
        }
        setReview((prev) => ({
          result: res.result,
          ply: prev ? prev.ply : Math.max(0, res.result.points.length),
        }));
        if (!res.result.progress?.running) break;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '复盘失败');
    } finally {
      setReviewing(false);
    }
  }, []);

  useEffect(() => () => { reviewDismissed.current = true; }, []);

  const enterEdit = () => {
    if (editing) {
      setEditing(false);
      setEditGrid(null);
      return;
    }
    setEditing(true);
    setError(null);
    setReview(null);
    setEditGrid(new Array(setup.size ** 2).fill(0));
    if (setupDetails.current) setupDetails.current.open = false;
    setPalette('B');
  };

  const startSetup = async () => {
    if (!editGrid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.newSetupGame({ size: setup.size, grid: editGrid, toPlay: editToPlay, komi: 7.5 });
      applyResponse(res);
      setEditing(false);
      setEditGrid(null);
      setSettlement(null);
      setAnalysis(null);
      setHoverPv(null);
      setPane('analysis');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '摆子开局失败');
    } finally {
      setBusy(false);
    }
  };

  const doRedo = async () => {
    if (!game) return;
    try {
      applyResponse(await api.redo(game.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重做失败');
    }
  };

  useEffect(() => {
    if (mode === 'free') void startGame(null);
    // 只在模式变化时自动开局；难度调整由「重新开局」按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 服务端推送（AI 落子 / 引擎状态）
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== 'game') return;
    const snap = lastEvent.data as GameSnapshot;
    if (!snap?.id || snap.id !== gameRef.current?.id) return;
    setGame(snap);
  }, [lastEvent]);

  // 对局结束但没拿到结算信息（例如 AI 认输）→ 拉一次完整状态
  useEffect(() => {
    if (!game || game.status !== 'finished' || settlement) return;
    let alive = true;
    void api
      .getGame(game.id)
      .then((res) => {
        if (!alive || gameRef.current?.id !== game.id) return;
        if (res.settlement) setSettlement(res.settlement);
        if (res.snapshot) setGame(res.snapshot);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game, settlement]);

  // 对局结束时播放结算音
  useEffect(() => {
    if (!game || game.status !== 'finished') return;
    playBell();

  }, [game?.status, game?.id]);

  // 实时分析（仅自在模式；防抖合并连续摆子）
  useEffect(() => {
    if (!game || !caps.allowAnalysis || game.status !== 'playing') return;
    let alive = true;
    setAnalyzing(true);
    const timer = window.setTimeout(() => {
      void api
        .analyze(game.id, undefined, assume)
        .then((res) => {
          if (!alive) return;
          if (res.available) {
            setAnalysis(res.result);
            setAnalysisReason(null);
          } else {
            setAnalysis(null);
            setAnalysisReason(res.reason);
          }
        })
        .catch(() => undefined)
        .finally(() => alive && setAnalyzing(false));
    }, 420);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [game?.id, game?.moves.length, game?.status, caps.allowAnalysis, assume]);

  // 结算阶段：死子变化时刷新形势
  useEffect(() => {
    if (!caps.allowUndo || !game || game.status !== 'scoring') return;
    let alive = true;
    void api
      .score(game.id, deadStones)
      .then((res) => alive && setScorePreview(res))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game?.id, game?.status, caps.allowUndo, deadStones.join(',')]);

  const play = async (vertex: number) => {
    if (!game || busy || game.aiThinking || game.status !== 'playing') return;
    if (game.toPlay !== game.playerColor && opponent !== 'human') return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.move(game.id, vertex);
      applyResponse(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '落子失败');
    } finally {
      setBusy(false);
    }
  };

  const doPass = async () => {
    if (!game) return;
    try {
      applyResponse(await api.pass(game.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '停一手失败');
    }
  };

  const doUndo = async () => {
    if (!game) return;
    const back = opponent === 'human' ? 1 : 2;
    try {
      applyResponse(await api.undo(game.id, Math.max(0, game.moves.length - back)));
      setPane('game');
      setSettlement(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '悔棋失败');
    }
  };

  const doEnd = async () => {
    if (!game) return;
    if (!window.confirm('双方停手，进入数子？（之后可以点棋盘上的死子再确认）')) return;
    try {
      applyResponse(await api.endGame(game.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '终局失败');
    }
  };

  const doResign = async () => {
    if (!game) return;
    if (!window.confirm(caps.quitLoses ? '认输这盘？本局会计负。' : '认输这盘？')) return;
    try {
      applyResponse(await api.resign(game.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '认输失败');
    }
  };

  const doFinish = async () => {
    if (!game || busy) return;
    setBusy(true);
    setError(null);
    try {
      applyResponse(await api.finish(game.id, deadStones));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '结算失败');
    } finally {
      setBusy(false);
    }
  };

  const exit = async () => {
    if (game && game.status === 'playing' && caps.quitLoses) {
      if (!window.confirm('修习模式下中途退出算负，确定离开？')) return;
      try {
        await api.quit(game.id);
      } catch (error) {
        setError(error instanceof ApiError ? error.message : '暂时无法退出对局，请重试。');
        return;
      }
    }
    onBack();
  };

  const importSgf = async (file: File) => {
    if (busy || reviewing) return;
    try {
      const text = await file.text();
      const res = await api.importSgf(text);
      applyResponse(res);
      setEditing(false);
      setEditGrid(null);
      setReview(null);
      setDeadStones([]);
      setScorePreview(null);
      setAnalysis(null);
      setHoverPv(null);
      setSettlement(null);
      setPane('game');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'SGF 解析失败');
    }
  };

  const ghost = useMemo(() => {
    if (!hoverPv || !game) return null;
    const out: { vertex: number; order: number }[] = [];
    hoverPv.pv.slice(0, 6).forEach((s, i) => {
      const v = gtpToVertex(game.size, s);
      if (v !== PASS) out.push({ vertex: v, order: i });
    });
    return out;
  }, [hoverPv, game]);

  // 复盘时按手数回放，不动服务端对局
  const replay = useMemo(() => {
    if (!review || !game) return null;
    const g = new Game({ size: game.size, komi: game.komi });
    const n = Math.min(review.ply, game.moves.length);
    for (let i = 0; i < n; i++) {
      const mv = game.moves[i]!;
      g.play(mv.color, mv.vertex);
    }
    return { grid: Array.from(g.board.grid), lastMove: n > 0 ? game.moves[n - 1]!.vertex : null };
  }, [review, game]);

  const canTeach = Boolean(game && opponent === 'katago' && game.status === 'finished' &&
    !game.handicap && game.moves.some((move) => move.color === game.playerColor && move.vertex !== PASS));
  const teachingGameId = canTeach ? game?.id : undefined;
  const teachingRunning = teaching?.phase === 'running';

  const openTeaching = async () => {
    if (!teachingGameId) return;
    if (teaching?.phase === 'ready') { setShowFirstGameReview(true); return; }
    setStartingTeaching(true);
    try {
      const status = await api.teachingReview(teachingGameId, true);
      if (gameRef.current?.id !== teachingGameId) return;
      setTeaching(status);
      setShowFirstGameReview(status.phase === 'ready');
    } catch (err) {
      if (gameRef.current?.id === teachingGameId) {
        setTeaching({ phase: 'unavailable', reason: err instanceof ApiError ? err.message : '无法开始教学复盘，请重试。' });
      }
    } finally {
      setStartingTeaching(false);
    }
  };

  useEffect(() => {
    if (!teachingRunning || !teachingGameId) return;
    let active = true;
    let timer: number;
    const poll = async () => {
      try {
        const status = await api.teachingReview(teachingGameId);
        if (!active || gameRef.current?.id !== teachingGameId) return;
        setTeaching(status);
        if (status.phase === 'ready') setShowFirstGameReview(true);
        if (status.phase === 'running') timer = window.setTimeout(() => void poll(), 700);
      } catch {
        if (active) setTeaching({ phase: 'unavailable', reason: '读取分析进度失败，可以重新打开教学复盘。' });
      }
    };
    timer = window.setTimeout(() => void poll(), 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [teachingRunning, teachingGameId]);

  const humanTurn = Boolean(
    game && game.status === 'playing' && !game.aiThinking && (opponent === 'human' || game.toPlay === game.playerColor),
  );

  const statusText = !game
    ? '开局中…'
    : game.status === 'finished'
      ? '终局'
      : game.status === 'scoring'
        ? '待数子'
        : game.aiThinking
          ? '对方思考中'
          : humanTurn
            ? '轮到你了'
            : '等待';
  const activePane = pane === 'analysis' && game?.status !== 'playing' ? 'game' : pane;

  const opponentLabel = opponent === 'offline' ? '离线对手' : opponent === 'human' ? '同机对手' : 'KataGo';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.matches('input, select, textarea, [contenteditable]')) return;
      if (e.key === 'f' || e.key === 'F') setShowOwnership((v) => !v);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setReview((r) => {
          if (!r) return r;
          const next = r.ply + (e.key === 'ArrowRight' ? 1 : -1);
          return { ...r, ply: Math.max(0, Math.min(r.result.points.length, next)) };
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (showFirstGameReview && teaching?.phase === 'ready' && game) {
    return (
      <FirstGameReviewView
        exercise={teaching.exercise}
        onTry={async (vertex) => (await api.tryTeachingMove(game.id, vertex)).attempt}
        hoverMark={bootstrap.config.ui.hoverMark}
        onBack={() => setShowFirstGameReview(false)}
        save={{ saved: teaching.saved, run: async () => {
          await api.saveMistake(game.id, 'katago');
          setTeaching((current) => current?.phase === 'ready' ? { ...current, saved: true } : current);
        } }}
      />
    );
  }

  return (
    <div className="game screen-game match-screen">
      <div className="board-column">
        <div className="topbar">
          <button className="linkish" onClick={() => void exit()}>
            ← 返回
          </button>
          <span className="brand">星弈</span>
          <span className="badge">{MODE_NAMES[mode]}</span>
          <span className="grow" />
          <span className={`badge${humanTurn && !review ? ' badge-live' : ''}`}>{review ? '复盘' : editing ? '摆棋' : statusText}</span>
        </div>

        <div className="seals">
          <div className="seal-block">
            <Seal text={levelCnFormal(game?.level ?? setup.level)} active={humanTurn} />
            <div className="seal-caption">{game && opponent !== 'human' ? (game.playerColor === 'B' ? '你执黑' : '你执白') : '你'}</div>
          </div>
          <span className="seal-vs">对</span>
          <div className="seal-block">
            <Seal text={levelCnFormal(game?.level ?? setup.level)} active={!humanTurn && game?.status === 'playing'} />
            <div className="seal-caption">
              难度 · {opponentLabel}
            </div>
          </div>
        </div>

        {error && <div className="notice hint-warn screen-notice" role="alert">{error}</div>}
        {!game && error && onEngineSettings && (
          <div className="controls"><button className="btn btn-primary" onClick={onEngineSettings}>打开引擎设置</button></div>
        )}

        {editing && (
          <div className="editor-bar">
            <span className="hint">摆棋 · 点击交叉点</span>
            <button className="btn" onClick={enterEdit}>退出摆棋</button>
            {(
              [
                ['B', '黑'],
                ['W', '白'],
                ['E', '擦'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`btn${palette === key ? ' btn-primary' : ''}`}
                onClick={() => setPalette(key)}
              >
                {label}
              </button>
            ))}
            <select value={editToPlay} onChange={(e) => setEditToPlay(e.target.value as 'B' | 'W')}>
              <option value="B">黑先</option>
              <option value="W">白先</option>
            </select>
            <button className="btn" onClick={() => setEditGrid(new Array(setup.size * setup.size).fill(0))}>
              清空
            </button>
            <button className="btn btn-primary" onClick={() => void startSetup()} disabled={busy}>
              开始分析
            </button>
          </div>
        )}

        {game?.clock && (
          <div className="clock-bar">
            {(['B', 'W'] as const).map((c) => {
              const ms = c === 'B' ? game.clock!.blackMs : game.clock!.whiteMs;
              const byo = game.clock!.inByoYomi[c];
              const low = ms <= 20000;
              return (
                <span
                  key={c}
                  className={'clock' + (game.clock!.running === c ? ' is-running' : '') + (low ? ' is-low' : '')}
                >
                  <b>{c === 'B' ? '黑' : '白'}</b>
                  <span className="clock-time">{fmtClock(ms)}</span>
                  {byo && (
                    <span className="clock-byo">
                      读秒 {'●'.repeat(Math.max(0, game.clock!.periods[c]))}
                      {game.clock!.periods[c] === 0 ? '最后' : ''}
                    </span>
                  )}
                </span>
              );
            })}
            {game.handicap >= 2 && <span className="badge">让 {game.handicap} 子</span>}
          </div>
        )}

        <div
          className="board-wrap"
          onDragOver={(e) => {
            if (mode === 'free') e.preventDefault();
          }}
          onDrop={(e) => {
            if (mode !== 'free') return;
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void importSgf(f);
          }}
        >
          {game ? (
            <Board
              size={editing ? setup.size : game.size}
              grid={editing ? (editGrid ?? []) : replay ? replay.grid : game.grid}
              lastMove={editing ? null : replay ? replay.lastMove : game.lastMove}
              ownership={editing || replay ? null : (analysis?.ownership ?? null)}
              showOwnership={!editing && !replay && showOwnership && caps.showWinrate}
              ghost={editing || replay ? null : ghost}
              hoverMark={bootstrap.config.ui.hoverMark}
              deadStones={!editing && !replay && game.status === 'scoring' ? deadStones : []}
              interactive={editing || (humanTurn && !review)}
              onPlace={(v) => {
                if (editing) {
                  setEditGrid((g) => {
                    if (!g) return g;
                    const next = [...g];
                    next[v] = palette === 'B' ? 1 : palette === 'W' ? 2 : 0;
                    return next;
                  });
                  return;
                }
                void play(v);
              }}
              onToggleDead={
                caps.allowUndo && !review && game.status === 'scoring'
                  ? (v) => {
                      // 点一颗子 = 整块一起标死（玩家不会一块棋点五下）
                      const group = new RulesBoard(game.size, game.grid).groupAt(v).stones;
                      const allDead = group.every((g) => deadStones.includes(g));
                      setDeadStones((d) =>
                        allDead ? d.filter((x) => !group.includes(x)) : [...new Set([...d, ...group])],
                      );
                    }
                  : undefined
              }
            />
          ) : (
            <div className="hint">{busy ? '正在开局…' : '没有对局'}</div>
          )}
        </div>
        {game?.status === 'scoring' && !editing && !review && (
          <section className="panel match-scoring" aria-label="数子">
            <div className="panel-head"><span className="panel-title">数子</span><span className="panel-sub">双方停手</span></div>
            {caps.allowUndo ? (
              <>
                <div className="match-score-values">
                  <span>黑 {scorePreview?.blackArea ?? '—'}</span>
                  <span>白 {scorePreview ? scorePreview.whiteArea + scorePreview.komi : '—'}（含贴目）</span>
                  {scorePreview && <strong>{scorePreview.winner ? `${scorePreview.winner === 'B' ? '黑' : '白'}胜 ${scorePreview.margin} 目` : '和棋'}</strong>}
                </div>
                <p className="hint">点棋子整块标死或取消。已标 {deadStones.length} 子。</p>
              </>
            ) : <p className="hint">KataGo 裁定死子，按中国规则数子。</p>}
            <div className="controls">
              <button className="btn btn-primary" onClick={() => void doFinish()} disabled={busy}>
                {busy ? '正在数子…' : caps.allowUndo ? '确认结算' : '自动数子并结算'}
              </button>
              {caps.allowUndo && <button className="btn" disabled={busy} onClick={() => void doUndo()}>撤销停手</button>}
            </div>
          </section>
        )}
        {game?.status === 'playing' && !editing && !review && (
          <div className="controls board-actions" role="group" aria-label="棋盘操作">
            <button className="btn" onClick={doPass} disabled={!humanTurn || busy}>停一手</button>
            {caps.allowUndo && <>
              <button className="btn" onClick={doUndo} disabled={busy || !game.moves.length}>悔棋</button>
              <button className="btn" onClick={() => void doRedo()} disabled={busy || !game.canRedo}>重做</button>
              <button className="btn" onClick={doEnd} disabled={busy}>终局数子</button>
            </>}
            <button className="btn" onClick={doResign} disabled={busy}>认输</button>
          </div>
        )}
        {review && <div className="board-actions review-position">回看第 {review.ply} 手</div>}
      </div>

      <aside className="side match-side">
        {game?.status === 'finished' && game.result && !editing && (
          <section className="panel match-result" aria-label="对局结算">
            <h2 className="result-text">{game.result.text}</h2>
            {settlement?.counted ? (
              <p className="hint">
                已计入进度{settlement.levelCn ? ` · ${settlement.levelCn}` : ''}
                {settlement.deltaR ? ` · ${settlement.deltaR > 0 ? '+' : ''}${settlement.deltaR}` : ''}
                {settlement.levelChange === 'up' ? ' · 升一级' : settlement.levelChange === 'down' ? ' · 降一级' : ''}
              </p>
            ) : <p className="hint">{settlement?.reason ?? (mode === 'ranked' ? '正在读取结算…' : '这盘不计入进度')}</p>}
            {Math.abs(settlement?.streak ?? 0) >= 2 && (
              <p className="hint">{cnNumber(settlement!.streak!)}{settlement!.streak! > 0 ? '连胜' : '连败'}</p>
            )}
            {settlement?.notes?.length ? <details className="screen-details"><summary>结算详情</summary><p className="hint">{settlement.notes.join('，')}</p></details> : null}
            <div className="controls match-result-actions">
              {canTeach && !review && (
                <button className="btn btn-primary" disabled={busy || reviewing || startingTeaching || teachingRunning} onClick={() => void openTeaching()}>
                  {startingTeaching || teachingRunning ? 'KataGo 正在挑选…' : '看一手，试一次'}
                </button>
              )}
              <button className={canTeach && !review ? 'btn' : 'btn btn-primary'} disabled={busy || startingTeaching || teachingRunning} onClick={initialGame ? onBack : () => void startGame(null)}>
                {initialGame ? '准备下一局' : '再来一局'}
              </button>
              {!review && <button className="btn" onClick={() => void startReview()} disabled={busy || reviewing || startingTeaching || teachingRunning || !game.moves.length}>
                {reviewing ? '正在复盘…' : '复盘'}
              </button>}
              <button className="btn" onClick={() => void exit()}>返回</button>
            </div>
            {teaching?.phase === 'running' && (
              <p className="hint" role="status">{teaching.total > 0 && teaching.done < teaching.total
                ? `正在检查你下过的棋 · ${teaching.done} / ${teaching.total}`
                : '正在比较实战着法和推荐变化…'}</p>
            )}
            {teaching?.phase === 'unavailable' && <p className="hint" role="status">{teaching.reason}</p>}
            {settlement?.pendingPromotion && game.level > STRONGEST_LEVEL && (
              <div className="controls match-result-actions">
                <button className="btn" disabled={busy || reviewing} onClick={() => void startGame(game.level - 1)}>考核 · 升一级</button>
                {game.level - 2 >= STRONGEST_LEVEL && <button className="btn" disabled={busy || reviewing} onClick={() => void startGame(game.level - 2)}>考核 · 升两级</button>}
              </div>
            )}
          </section>
        )}

        {reviewing && !review && <div className="notice" role="status">正在分析棋局…</div>}
        {review && game ? (
          <ReviewPanel
            result={review.result}
            ply={review.ply}
            moves={game.moves}
            onPick={(ply) => setReview((current) => current && { ...current, ply })}
            onExit={() => { reviewDismissed.current = true; setReview(null); }}
            onCancel={() => { reviewCancelled.current = true; }}
          />
        ) : (
          <>
            <div className="screen-tabs" role="group" aria-label="棋局侧栏">
              <button className="btn" aria-pressed={activePane === 'game'} onClick={() => setPane('game')}>对局</button>
              {caps.allowAnalysis && game?.status === 'playing' && <button className="btn" aria-pressed={activePane === 'analysis'} onClick={() => setPane('analysis')}>形势</button>}
              <button className="btn" aria-pressed={activePane === 'moves'} onClick={() => setPane('moves')}>手数</button>
            </div>
            {activePane === 'game' && <section className="panel">
              <div className="panel-head"><span className="panel-title">对局</span><span className="panel-sub">{game ? `${game.size} 路 · 贴 ${game.komi} 目` : '—'}</span></div>
              <div className="stat-row"><span className="stat-key">提子（黑 / 白）</span><span className="stat-val">{game ? `${game.captures.W} / ${game.captures.B}` : '—'}</span></div>
              <div className="stat-row"><span className="stat-key">手数</span><span className="stat-val">{game?.moves.length ?? 0}</span></div>
              {placementStage !== null && game && game.status !== 'finished' && <p className="hint">定级赛第 {placementStage + 1} 盘 · 对手 {levelCn(game.level)}</p>}
              {opponent === 'offline' && <p className="hint">当前使用离线对手。离线难度为粗略近似。</p>}
              {!caps.allowUndo && <p className="hint">{CAP_NOTES.allowUndo}。</p>}
            </section>}
            {activePane === 'analysis' && caps.allowAnalysis && (
              <>
                <AnalysisPanel
                  caps={caps}
                  analysis={analysis}
                  unavailableReason={analysisReason}
                  loading={analyzing}
                  showOwnership={showOwnership}
                  onToggleOwnership={() => setShowOwnership((value) => !value)}
                  onHover={(vertex) => setHoverPv(analysis?.candidates.find((candidate) => candidate.vertex === vertex) ?? null)}
                  onPick={(vertex) => void play(vertex)}
                  canPlay={humanTurn}
                />
                <div className="controls">
                  <select aria-label="假设对手水平" value={assumeDelta} onChange={(event) => setAssumeDelta(Number(event.target.value))}>
                    <option value={0}>假设：同水平</option>
                    <option value={-3}>假设：弱 3 级</option>
                    <option value={-6}>假设：弱 6 级</option>
                    <option value={3}>假设：强 3 级</option>
                  </select>
                  {Boolean(game?.moves.length) && <button className="btn" disabled={reviewing} onClick={() => void startReview()}>形势曲线</button>}
                </div>
              </>
            )}
            {activePane === 'moves' && (
              <MoveList size={game?.size ?? 19} moves={game?.moves ?? []}
                onJump={caps.allowUndo && game?.status === 'playing' ? (ply) => void api.undo(game.id, ply).then(applyResponse).catch(() => undefined) : undefined} />
            )}
            {mode === 'free' && <details className="panel screen-details match-setup" ref={setupDetails}>
              <summary>新局设置</summary>
              <div className="field">
                <label htmlFor="match-size">棋盘</label>
                <select id="match-size" value={setup.size} onChange={(event) => setSetup({ ...setup, size: Number(event.target.value) as Setup['size'] })}>
                  <option value={9}>9 路</option><option value={13}>13 路</option><option value={19}>19 路</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="match-level">难度</label>
                <select id="match-level" value={setup.level} onChange={(event) => setSetup({ ...setup, level: Number(event.target.value) })}>
                  {Array.from({ length: bootstrap.progress.maxLevel }, (_, i) => bootstrap.progress.maxLevel - i).map((level) =>
                    <option key={level} value={level}>{levelCn(level)}</option>
                  )}
                </select>
              </div>
              <div className="field">
                <label htmlFor="match-handicap">让子</label>
                <select id="match-handicap" value={setup.handicap} onChange={(event) => setSetup({ ...setup, handicap: Number(event.target.value) })}>
                  <option value={0}>不让子</option>
                  {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>让 {n} 子</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="match-clock">时间</label>
                <select id="match-clock" value={setup.timePreset} onChange={(event) => setSetup({ ...setup, timePreset: event.target.value as TimePresetId })}>
                  {TIME_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </div>
              {setup.handicap >= 2 && <p className="hint">让子局白先，贴 0.5 目。</p>}
              <div className="controls">
                <button className="btn btn-primary" onClick={() => void startGame(null)} disabled={busy || reviewing}>开始新对局</button>
                <button className="btn" onClick={enterEdit} disabled={busy || reviewing}>{editing ? '退出摆棋' : '摆棋'}</button>
                <button className="btn" onClick={() => sgfInput.current?.click()} disabled={busy || reviewing}>导入棋谱</button>
                <input ref={sgfInput} type="file" accept=".sgf,application/x-go-sgf" hidden onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importSgf(file);
                  event.target.value = '';
                }} />
              </div>
            </details>}
          </>
        )}
      </aside>
    </div>
  );
}
