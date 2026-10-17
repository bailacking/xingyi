import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gtpToVertex } from '@xingyi/shared';
import { Board as RulesBoard, Game } from '@xingyi/rules';
import { Board } from '../board/Board';
import { api, ApiError, type Bootstrap, type GameResponse, type SocketEvent } from '../api';
import { AnalysisPanel } from '../panels/AnalysisPanel';
import { MoveList } from '../panels/MoveList';
import { ReviewPanel } from '../panels/ReviewPanel';
import { playBell, playStone } from '../sound';
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
  onBack: () => void;
}

const cnNumber = (n: number): string => levelCn(Math.abs(n)).replace('级', '');

export function GameView({ mode, bootstrap, lastEvent, onBack }: GameViewProps) {
  const caps = CAPS[mode];
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [opponent, setOpponent] = useState<'katago' | 'offline' | 'human'>('offline');
  const [isPlacement, setIsPlacement] = useState(false);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
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
  const [showResult, setShowResult] = useState(false);
  const [review, setReview] = useState<{ result: ReviewResult; ply: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editGrid, setEditGrid] = useState<number[] | null>(null);
  const [palette, setPalette] = useState<'B' | 'W' | 'E'>('B');
  const [editToPlay, setEditToPlay] = useState<'B' | 'W'>('B');
  const [assume, setAssume] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const autoReviewed = useRef(false);
  const [setup, setSetup] = useState({
    size: bootstrap.config.game.boardSize,
    level: Math.min(8, bootstrap.progress.maxLevel),
    playerColor: bootstrap.config.ui.playerColor,
  });

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
    setGame(res.snapshot);
    if (res.opponent) setOpponent(res.opponent);
    if (typeof res.isPlacement === 'boolean') setIsPlacement(res.isPlacement);
    if (res.settlement) setSettlement(res.settlement);
    if (res.warnings?.length) setError(res.warnings.join(' / '));
  }, []);

  const startGame = useCallback(
    async (examLevel?: number | null) => {
      setBusy(true);
      setError(null);
      setSettlement(null);
      setShowResult(false);
      setAnalysis(null);
      setAnalysisReason(null);
      setDeadStones([]);
      setScorePreview(null);
      setReview(null);
      setReviewing(false);
      autoReviewed.current = false;
      try {
        const res = await api.newGame(
          mode === 'ranked'
            ? { mode, examLevel: examLevel ?? null }
            : {
                mode,
                size: setup.size,
                level: setup.level,
                playerColor: setup.playerColor,
                komi: 7.5,
              },
        );
        applyResponse(res);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '开局失败');
      } finally {
        setBusy(false);
      }
    },
    [applyResponse, mode, setup.level, setup.playerColor, setup.size],
  );

  const startReview = useCallback(async () => {
    const g = gameRef.current;
    if (!g) return;
    setReviewing(true);
    setError(null);
    try {
      const res = await api.review(g.id);
      if (res.available) {
        setReview({ result: res.result, ply: res.result.points.length });
        setShowResult(false);
      } else setError(res.reason);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '复盘失败');
    } finally {
      setReviewing(false);
    }
  }, []);

  const enterEdit = () => {
    if (editing) {
      setEditing(false);
      setEditGrid(null);
      return;
    }
    setEditing(true);
    setReview(null);
    setEditGrid(new Array(setup.size * setup.size).fill(0));
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
      setShowResult(false);
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

  // 输了自动进复盘（可以随时退出）
  useEffect(() => {
    if (review || reviewing || autoReviewed.current) return;
    if (!game || game.status !== 'finished' || settlement?.won !== false) return;
    autoReviewed.current = true;
    void startReview();
  }, [game?.status, settlement?.won, review, reviewing, startReview]);

  useEffect(() => {
    void startGame(null);
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
        if (!alive) return;
        if (res.settlement) setSettlement(res.settlement);
        if (res.snapshot) setGame(res.snapshot);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game, settlement]);

  // 结束时一声磬 + 弹出结算
  useEffect(() => {
    if (!game || game.status !== 'finished') return;
    playBell();
    setShowResult(true);
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
    if (!game || game.status !== 'scoring') return;
    let alive = true;
    void api
      .score(game.id, deadStones)
      .then((res) => alive && setScorePreview(res))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game?.id, game?.status, deadStones.join(',')]);

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
      setShowResult(false);
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
    if (!window.confirm('认输这盘？修习模式下会算负并计入进度。')) return;
    try {
      applyResponse(await api.resign(game.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '认输失败');
    }
  };

  const doFinish = async () => {
    if (!game) return;
    try {
      applyResponse(await api.finish(game.id, deadStones));
      setShowResult(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '结算失败');
    }
  };

  const exit = async () => {
    if (game && game.status === 'playing' && caps.quitLoses) {
      if (!window.confirm('修习模式下中途退出算负，确定离开？')) return;
      try {
        await api.quit(game.id);
      } catch {
        /* 忽略 */
      }
    }
    onBack();
  };

  const importSgf = async (file: File) => {
    try {
      const text = await file.text();
      const res = await api.importSgf(text);
      applyResponse(res);
      setSettlement(null);
      setShowResult(false);
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

  const opponentLabel = opponent === 'offline' ? '离线对手' : opponent === 'human' ? '同机对手' : 'KataGo';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') setShowOwnership((v) => !v);
      if (e.key === 'Escape') setShowResult(false);
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

  return (
    <div className="game">
      <div className="board-column">
        <div className="topbar">
          <button className="linkish" onClick={() => void exit()}>
            ← 返回
          </button>
          <span className="brand">星弈</span>
          <span className="badge">{MODE_NAMES[mode]}</span>
          <span className="grow" />
          {mode === 'free' && (
            <>
              <select
                value={setup.size}
                onChange={(e) => setSetup((s) => ({ ...s, size: Number(e.target.value) as 9 | 13 | 19 }))}
                style={{ width: 88 }}
                title="棋盘路数（改完点重新开局）"
              >
                <option value={9}>9 路</option>
                <option value={13}>13 路</option>
                <option value={19}>19 路</option>
              </select>
              <select
                value={setup.level}
                onChange={(e) => setSetup((s) => ({ ...s, level: Number(e.target.value) }))}
                style={{ width: 100 }}
                title="对手难度"
              >
                {Array.from({ length: bootstrap.progress.maxLevel }, (_, i) => i + 1).map((lv) => (
                  <option key={lv} value={lv}>
                    {levelCn(lv)}
                  </option>
                ))}
              </select>
              <select
                value={assume === null ? 0 : assume - setup.level}
                onChange={(e) => {
                  const delta = Number(e.target.value);
                  setAssume(delta === 0 ? null : Math.min(15, Math.max(1, setup.level + delta)));
                }}
                style={{ width: 132 }}
                title="摆棋/分析时假设对手水平（只影响分析，不影响对局）"
              >
                <option value={0}>假设：同水平</option>
                <option value={-3}>假设：弱 3 级</option>
                <option value={-6}>假设：弱 6 级</option>
                <option value={3}>假设：强 3 级</option>
              </select>
              <button className="btn" onClick={() => void startGame(null)} disabled={busy}>
                重新开局
              </button>
              <button className="btn" onClick={enterEdit}>
                {editing ? '退出摆棋' : '摆棋'}
              </button>
              <label className="btn" style={{ cursor: 'pointer' }}>
                导入棋谱
                <input
                  type="file"
                  accept=".sgf,application/x-go-sgf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importSgf(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
          <span className={`badge${humanTurn ? ' badge-live' : ''}`}>{statusText}</span>
        </div>

        <div className="seals">
          <div className="seal-block">
            <div className={`seal${humanTurn ? ' is-active' : ''}`}>{levelCnFormal(game?.level ?? 8)}</div>
            <div className="seal-caption">{isPlacement ? '定级 · 你' : '你'}</div>
          </div>
          <span className="seal-vs">对</span>
          <div className="seal-block">
            <div className={`seal${!humanTurn && game?.status === 'playing' ? ' is-active' : ''}`}>
              {levelCnFormal(game?.level ?? 8)}
            </div>
            <div className="seal-caption">
              难度 · {opponentLabel}
            </div>
          </div>
        </div>

        {editing && (
          <div className="editor-bar">
            <span className="hint">摆棋：点棋盘落子</span>
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
                !review && game.status === 'scoring'
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
      </div>

      <aside className="side">
        {game?.status === 'scoring' && (
          <section className="panel" style={{ borderColor: 'var(--accent)' }}>
            <div className="panel-head">
              <span className="panel-title">数子</span>
              <span className="panel-sub">双方停手</span>
            </div>
            {scorePreview ? (
              <>
                <div className="stat-row">
                  <span className="stat-key">黑（子 + 空）</span>
                  <span className="stat-val">{scorePreview.blackArea} 目</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">白（子 + 空 + 贴 {scorePreview.komi}）</span>
                  <span className="stat-val">{scorePreview.whiteArea + scorePreview.komi} 目</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">结论</span>
                  <span className="stat-val" style={{ fontFamily: 'var(--font-title)', fontSize: 17 }}>
                    {scorePreview.winner === 'B'
                      ? `黑胜 ${scorePreview.margin} 目`
                      : scorePreview.winner === 'W'
                        ? `白胜 ${scorePreview.margin} 目`
                        : '和棋'}
                  </span>
                </div>
              </>
            ) : (
              <div className="hint">正在数子…</div>
            )}
            <div className="hint" style={{ marginTop: 10 }}>
              棋盘上的死子点一下整块标死（红叉），再点取消。已标 {deadStones.length} 子。
              不标死子，数目会偏。
            </div>
            <div className="controls" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={() => void doFinish()}>
                确认结算
              </button>
              {caps.allowUndo && (
                <button className="btn" onClick={() => void doUndo()}>
                  撤销停手
                </button>
              )}
            </div>
          </section>
        )}

        {isPlacement && game && (
          <div className="notice">
            定级赛 第 {bootstrap.progress.placement.stage + 1} 盘 · 对手 {levelCn(game.level)}
            <br />
            <span className="hint">
              三盘自适应定级，前 10 盘为暂定级。下完才知道你在哪一级，不用挑难度。
            </span>
          </div>
        )}

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">对局</span>
            <span className="panel-sub">
              {game ? `${game.size} 路 · 贴 ${game.komi} 目` : '—'}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-key">提子（黑/白）</span>
            <span className="stat-val">
              {game ? `${game.captures.W} / ${game.captures.B}` : '—'}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-key">手数</span>
            <span className="stat-val">{game?.moves.length ?? 0}</span>
          </div>
          {opponent === 'offline' && (
            <div className="hint" style={{ marginTop: 8 }}>
              当前是<strong>离线对手</strong>（程序自带启发式陪练，不是 KataGo）。装上引擎后会自动换成真对手；
              自定义的等级难度在离线模式下只是粗略近似。
            </div>
          )}

          <div className="controls" style={{ marginTop: 12 }}>
            <button className="btn" onClick={doPass} disabled={!humanTurn}>
              停一手
            </button>
            <button
              className="btn"
              onClick={doUndo}
              disabled={!caps.allowUndo || !game || game.moves.length === 0}
              title={caps.allowUndo ? '退回上一手（AI 会重算）' : CAP_NOTES.allowUndo}
            >
              悔棋
            </button>
            <button className="btn" onClick={() => void doRedo()} disabled={!caps.allowUndo || !game?.canRedo}>
              重做
            </button>
            {mode === 'free' && (
              <button className="btn" onClick={doEnd} disabled={!game || game.status !== 'playing'}>
                终局数子
              </button>
            )}
            <button className="btn" onClick={doResign} disabled={!game || game.status !== 'playing'}>
              认输
            </button>
            {game && game.moves.length > 0 && !review && (
              <button className="btn" onClick={() => void startReview()} disabled={reviewing}>
                {game.status === 'finished' ? '复盘 / 曲线' : '形势曲线'}
              </button>
            )}
          </div>
          {!caps.allowUndo && <div className="hint" style={{ marginTop: 8 }}>{CAP_NOTES.allowUndo}。</div>}
        </section>

        {reviewing && !review && (
          <div className="notice">
            正在复盘：引擎要逐手重算一遍，19 路大约 1~3 分钟，可以先去倒杯水。
          </div>
        )}

        {review && game ? (
          <ReviewPanel
            result={review.result}
            ply={review.ply}
            moves={game.moves}
            onPick={(ply) => setReview((r) => (r ? { ...r, ply } : r))}
            onExit={() => setReview(null)}
          />
        ) : (
        <AnalysisPanel
          caps={caps}
          analysis={analysis}
          unavailableReason={analysisReason}
          loading={analyzing}
          showOwnership={showOwnership}
          onToggleOwnership={() => setShowOwnership((v) => !v)}
          onHover={(v) => {
            if (v === null) {
              setHoverPv(null);
              return;
            }
            const cand = analysis?.candidates.find((c) => c.vertex === v) ?? null;
            setHoverPv(cand);
          }}
          onPick={(v) => void play(v)}
          canPlay={humanTurn && !review}
        />
        )}

        <MoveList
          size={game?.size ?? 19}
          moves={game?.moves ?? []}
          onJump={caps.allowUndo && game ? (ply) => void api.undo(game.id, ply).then(applyResponse).catch(() => undefined) : undefined}
        />

        {error && <div className="notice hint-warn">{error}</div>}
        <div className="hint" style={{ textAlign: 'center' }}>
          快捷键：F 形势图 · Esc 关闭结算
        </div>
      </aside>

      {showResult && game?.status === 'finished' && game.result && (
        <div className="overlay" onClick={() => setShowResult(false)}>
          <div className="result-card" onClick={(e) => e.stopPropagation()}>
            <div className="hint" style={{ letterSpacing: '.2em' }}>
              {MODE_NAMES[mode]}
            </div>
            <div className="result-text">{game.result.text}</div>
            {(settlement?.streak ?? 0) >= 2 && <div className="result-line">{cnNumber(settlement!.streak!)}连胜</div>}
            {(settlement?.streak ?? 0) <= -2 && <div className="result-line">{cnNumber(settlement!.streak!)}连败</div>}
            {settlement?.counted ? (
              <div className="result-line">
                已计入进度
                {typeof settlement.deltaR === 'number' && settlement.deltaR !== 0
                  ? ` · ${settlement.deltaR > 0 ? '+' : ''}${settlement.deltaR}`
                  : ''}
                {settlement.levelChange === 'up' ? ' · 升一级' : settlement.levelChange === 'down' ? ' · 降一级' : ''}
              </div>
            ) : (
              <div className="result-line">{settlement?.reason ?? '这盘不计入进度'}</div>
            )}
            {settlement?.levelCn && <div className="result-line">{settlement.levelCn}</div>}
            {settlement?.notes?.length ? <div className="hint">{settlement.notes.join('；')}</div> : null}

            {settlement?.pendingPromotion && game.level < bootstrap.progress.maxLevel && (
              <div className="result-actions" style={{ marginTop: 6 }}>
                <button
                  className="result-link"
                  onClick={() => void startGame(Math.min(bootstrap.progress.maxLevel, game.level + 1))}
                >
                  考核 · 升一级 →
                </button>
                {game.level + 2 <= bootstrap.progress.maxLevel && (
                  <button className="result-link" onClick={() => void startGame(game.level + 2)}>
                    考核 · 升两级 →
                  </button>
                )}
              </div>
            )}

            <div className="result-actions">
              <button className="btn" onClick={() => void startReview()} disabled={reviewing}>
                {reviewing ? '复盘计算中…' : '复盘'}
              </button>
              <button className="btn btn-primary" onClick={() => void startGame(null)}>
                再来一局
              </button>
              <button className="btn" onClick={() => void exit()}>
                返回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
