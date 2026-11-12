import { useCallback, useEffect, useMemo, useState } from 'react';
import { Game } from '@xingyi/rules';
import { Board } from '../board/Board';
import type { Bootstrap } from '../api';

interface LearnViewProps {
  bootstrap: Bootstrap;
  onBack: () => void;
}

interface JosekiItem {
  id: string;
  title: string;
  category: string;
  size: number;
  moves: number;
}

/** 详情不带答案：只给总手数与每手的先后手 */
interface JosekiView {
  id: string;
  title: string;
  size: number;
  category: string;
  note: string;
  total: number;
  colors: ('B' | 'W')[];
}

interface JosekiCheck {
  correct: boolean;
  expected?: string;
  done: boolean;
  step: number;
  total: number;
  message: string;
}

/**
 * 定式三只请求写在这里而不是 web/src/api.ts：那是多张卡共用的文件（W2/W4 也在改），
 * 本卡的文件边界只到 LearnView。合卡时可以整体挪回 api.ts。
 */
async function josekiReq<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { ...init, headers });
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
    throw new Error(message);
  }
  return data as T;
}

const josekiApi = {
  list: () => josekiReq<{ joseki: JosekiItem[] }>('/api/joseki'),
  get: (id: string) => josekiReq<JosekiView>(`/api/joseki/${encodeURIComponent(id)}`),
  check: (id: string, step: number, vertex: number) =>
    josekiReq<JosekiCheck>(`/api/joseki/${encodeURIComponent(id)}/check`, {
      method: 'POST',
      body: JSON.stringify({ step, vertex }),
    }),
};

/** 按已走的手数重放盘面（颜色由服务端给的 colors 决定，不靠奇偶猜） */
function josekiGrid(view: JosekiView, moves: number[]): number[] {
  const game = new Game({ size: view.size as 9 | 13 | 19, komi: 7.5 });
  moves.forEach((vertex, i) => {
    game.play(view.colors[i] ?? (i % 2 === 0 ? 'B' : 'W'), vertex);
  });
  return Array.from(game.board.grid);
}

export function LearnView({ bootstrap, onBack }: LearnViewProps) {
  const [josekiList, setJosekiList] = useState<JosekiItem[]>([]);
  const [joseki, setJoseki] = useState<JosekiView | null>(null);
  const [josekiMoves, setJosekiMoves] = useState<number[]>([]);
  const [josekiMsg, setJosekiMsg] = useState<string | null>(null);
  const [josekiDone, setJosekiDone] = useState(false);
  const [josekiBusy, setJosekiBusy] = useState(false);

  useEffect(() => {
    void josekiApi
      .list()
      .then((res) => setJosekiList(res.joseki))
      .catch(() => setJosekiList([]));
  }, []);

  const openJoseki = useCallback(async (id: string): Promise<void> => {
    setJosekiMoves([]);
    setJosekiMsg(null);
    setJosekiDone(false);
    setJosekiBusy(true);
    try {
      setJoseki(await josekiApi.get(id));
    } catch (err) {
      setJoseki(null);
      setJosekiMsg(err instanceof Error ? err.message : '这个定式加载失败了');
    } finally {
      setJosekiBusy(false);
    }
  }, []);

  const restartJoseki = (): void => {
    setJosekiMoves([]);
    setJosekiMsg(null);
    setJosekiDone(false);
  };

  const playJoseki = async (vertex: number): Promise<void> => {
    if (!joseki || josekiDone || josekiBusy) return;
    setJosekiBusy(true);
    try {
      const res = await josekiApi.check(joseki.id, josekiMoves.length, vertex);
      if (res.correct) {
        setJosekiMoves((m) => [...m, vertex]);
        setJosekiDone(res.done);
        setJosekiMsg(res.done ? res.message : null);
      } else {
        setJosekiMsg(res.message);
      }
    } catch (err) {
      setJosekiMsg(err instanceof Error ? err.message : '这一手没送出去，再试一次');
    } finally {
      setJosekiBusy(false);
    }
  };

  const josekiGridNow = useMemo(() => (joseki ? josekiGrid(joseki, josekiMoves) : null), [joseki, josekiMoves]);

  const boardSize = (joseki?.size ?? 19) as 9 | 13 | 19;
  const boardGrid = josekiGridNow ?? new Array(boardSize ** 2).fill(0);
  const boardInteractive = Boolean(joseki) && !josekiDone && !josekiBusy;
  const boardProgress = joseki ? `第 ${Math.min(josekiMoves.length + 1, joseki.total)} / ${joseki.total} 手` : '';

  return (
    <div className="game">
      <div className="board-column">
        <div className="topbar">
          <button className="linkish" onClick={onBack}>
            ← 返回
          </button>
          <span className="brand">星弈</span>
          <span className="badge">教学</span>
          <span className="grow" />
          {boardProgress && <span className="badge">{boardProgress}</span>}
        </div>
        <div className="board-wrap">
          <Board
            size={boardSize}
            grid={boardGrid}
            lastMove={josekiMoves.at(-1) ?? null}
            ownership={null}
            showOwnership={false}
            ghost={null}
            hoverMark={bootstrap.config.ui.hoverMark}
            deadStones={[]}
            interactive={boardInteractive}
            onPlace={(v) => void playJoseki(v)}
          />
        </div>
      </div>

      <aside className="side">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">定式练习</span>
            <span className="panel-sub">角部常用下法 · 不计进度</span>
          </div>

          <div className="room-list" style={{ marginTop: 10 }}>
            {josekiList.map((j) => (
              <button
                key={j.id}
                className={`room-item${joseki?.id === j.id ? ' is-active' : ''}`}
                onClick={() => void openJoseki(j.id)}
              >
                <span>{j.title}</span>
                <span className="hint">
                  {j.category} · {j.moves} 手
                </span>
              </button>
            ))}
          </div>
          {josekiList.length === 0 && <div className="hint">定式表还没加载出来。</div>}
          <div className="hint" style={{ marginTop: 6 }}>
            定式是角上经过验证的下法。照着手顺摆，摆错会告诉你是第几手、该下哪儿。
          </div>

          {joseki && (
            <div style={{ marginTop: 12 }}>
              <div className="panel-head" style={{ padding: 0 }}>
                <span className="panel-title" style={{ fontSize: 15 }}>
                  {joseki.title}
                </span>
                <span className="panel-sub">{josekiDone ? '已完成' : `${joseki.category} · ${joseki.total} 手`}</span>
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                {joseki.note}
              </div>
              {josekiMsg && <div className={`notice${josekiDone ? '' : ' hint-warn'}`}>{josekiMsg}</div>}
              {!josekiDone && !josekiMsg && (
                <div className="hint">轮到{joseki.colors[josekiMoves.length] === 'W' ? '白' : '黑'}棋：点棋盘落子。</div>
              )}
              {josekiDone && <div className="hint">可以点「重来」再走一遍，或者换一条定式。</div>}
              <div className="controls" style={{ marginTop: 8 }}>
                <button className="btn" onClick={restartJoseki} disabled={josekiMoves.length === 0}>
                  重来
                </button>
              </div>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
