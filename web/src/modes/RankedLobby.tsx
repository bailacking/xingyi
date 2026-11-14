import { useEffect, useState } from 'react';
import { PLACEMENT_GAMES } from '@xingyi/shared';
import { api, ApiError, type GameResponse } from '../api';
import { levelCn, type ProgressView } from '../types';

interface RankedLobbyProps {
  progress: ProgressView;
  engineReady: boolean;
  onBack: () => void;
  onSettings: () => void;
  onStart: (game: GameResponse) => void;
}

export function RankedLobby({ progress, engineReady, onBack, onSettings, onStart }: RankedLobbyProps) {
  const [current, setCurrent] = useState(progress);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api.progress().then((data) => {
      if (active) setCurrent(data);
    }).catch(() => {
      if (active) setError('暂时无法刷新战绩，请返回后重试。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const match = current.rankedMatch;
  const level = match?.level ?? (current.placement.done ? current.level : current.placement.current);
  const latest = current.history.at(-1)?.level ?? current.placement.results.at(-1)?.level;
  const color = match?.playerColor ?? (current.gamesTotal % 2 === 0 ? 'B' : 'W');
  const unknown = Math.max(0, current.gamesTotal - current.gamesWon - current.gamesLost);
  const ready = engineReady || match !== null;

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      onStart(await api.newGame({ mode: 'ranked', saveId: current.activeSaveId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '开局失败，请重试。');
      setBusy(false);
    }
  };

  return (
    <main className="settings ranked-ready-screen">
      <div className="settings-inner ranked-lobby">
        <div className="topbar">
          <button className="linkish" onClick={onBack} disabled={busy}>← 返回</button>
          <span className="brand">星弈</span>
        </div>
        <section className="panel">
          <h2>修习准备</h2>
          {current.activeSaveId ? <>
            <p className="hint">{current.playerName} · {current.placement.done ? `${current.levelCn}${current.provisional ? '（暂定）' : ''}` : `定级 ${current.placement.stage} / ${PLACEMENT_GAMES}`}</p>
            <dl className="ranked-stats">
              <div><dt>已完成</dt><dd>{current.gamesTotal} 局</dd></div>
              <div><dt>胜</dt><dd>{current.gamesWon} 局</dd></div>
              <div><dt>负</dt><dd>{current.gamesLost} 局</dd></div>
            </dl>
            {unknown > 0 && <p className="hint">旧存档有 {unknown} 局未保留胜负明细。</p>}
            <div className="ranked-next">
              <div className="stat-row"><span className="stat-key">{match ? '进行中难度' : '下一局难度'}</span><strong>{levelCn(level)}</strong></div>
              {latest !== undefined && <div className="stat-row"><span className="stat-key">上局难度</span><span>{levelCn(latest)}</span></div>}
              <p className="hint">十九路分先 · 贴 7.5 目 · 你执{color === 'B' ? '黑' : '白'}</p>
            </div>
            {!ready && <p className="hint">在设置里启用 KataGo、主模型和人类模型后即可开始。</p>}
            <div className="controls">
              <button className="btn btn-primary" disabled={loading || busy || !ready} onClick={() => void start()}>{busy ? '正在开局…' : match ? '继续对局' : '确认开局'}</button>
              {!ready && <button className="btn" onClick={onSettings}>打开设置</button>}
            </div>
          </> : <>
            <p>请先建立一个修习存档。</p>
            <button className="btn btn-primary" onClick={onSettings}>前往存档管理</button>
          </>}
          {error && <p className="notice hint-warn" role="alert">{error}</p>}
        </section>
      </div>
    </main>
  );
}
