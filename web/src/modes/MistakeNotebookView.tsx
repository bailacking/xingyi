import { useEffect, useRef, useState } from 'react';
import type { SavedMistake } from '@xingyi/shared';
import { api, ApiError } from '../api';
import { EXERCISE_TITLES, FirstGameReviewView } from './FirstGameReviewView';
import '../styles/mistakes.css';

const DATE = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });

interface MistakeNotebookProps {
  hoverMark: 'square' | 'ghost';
  onBack: () => void;
}

export function MistakeNotebookView({ hoverMark, onBack }: MistakeNotebookProps) {
  const [entries, setEntries] = useState<SavedMistake[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [request, retry] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    api.listMistakes().then(
      (items) => { if (active) setEntries(items); },
      (err) => { if (active) setError(err instanceof ApiError ? err.message : '读取错题失败，请重试。'); },
    );
    return () => { active = false; };
  }, [request]);

  useEffect(() => { if (selected === null) title.current?.focus(); }, [selected]);

  const remove = async (id: string) => {
    if (!window.confirm('从我的错题移除这道题？')) return;
    setRemoving(id);
    setError('');
    try {
      await api.removeMistake(id);
      setEntries((items) => items?.filter((item) => item.gameId !== id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '移除失败，请重试。');
    } finally {
      setRemoving(null);
    }
  };

  const active = entries?.find((item) => item.gameId === selected);
  if (active) return (
    <FirstGameReviewView
      exercise={active.exercise}
      hoverMark={hoverMark}
      onBack={() => setSelected(null)}
      onTry={active.exercise.comparison ? async (vertex) => {
        const { attempt, updated } = await api.tryMistake(active.gameId, vertex);
        if (updated) setEntries((items) => items?.map((item) => item.gameId === updated.gameId ? updated : item) ?? null);
        return attempt;
      } : undefined}
      onPracticed={active.exercise.comparison ? undefined : async (vertex) => {
        const updated = await api.practiceMistake(active.gameId, vertex);
        setEntries((items) => items?.map((item) => item.gameId === updated.gameId ? updated : item) ?? null);
      }}
      fromNotebook
    />
  );

  return (
    <main className="learn-screen mistake-notebook">
      <div className="learn-inner">
        <header className="learn-header">
          <button className="linkish" onClick={onBack}>← 返回入门</button>
          <h1 ref={title} tabIndex={-1}>我的错题</h1>
        </header>
        {error && (
          <div className="notice hint-warn" role="alert">
            {error}{!entries && <button className="btn" onClick={() => { setError(''); retry(request + 1); }}>重试</button>}
          </div>
        )}
        {!entries && !error && <p className="hint" role="status">正在读取错题…</p>}
        {entries?.length === 0 && <p className="panel">这里还没有错题。首盘练习棋结算后，打开「看一手，试一次」就能把局面加入这里。</p>}
        {!!entries?.length && (
          <ul className="mistake-list" aria-label="已保存的错题">
            {[...entries].reverse().map(({ gameId, savedAt, lastPracticedAt, exercise }) => (
              <li className="panel mistake-row" key={gameId}>
                <div>
                  <h2>{EXERCISE_TITLES[exercise.kind]}</h2>
                  <p className="hint">第 {exercise.prefix.length + 1} 手 · 收录于 <time dateTime={savedAt}>{DATE.format(new Date(savedAt))}</time></p>
                  <p className="hint">{lastPracticedAt ? <>上次练对 <time dateTime={lastPracticedAt}>{DATE.format(new Date(lastPracticedAt))}</time></> : '待回练'}</p>
                </div>
                <div className="mistake-actions">
                  <button className="btn btn-primary" disabled={removing !== null} onClick={() => setSelected(gameId)}>重练</button>
                  <button className="btn" disabled={removing !== null} onClick={() => void remove(gameId)}>移除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
