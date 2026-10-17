import { useCallback, useEffect, useMemo, useState } from 'react';
import { Game } from '@xingyi/rules';
import { Board } from '../board/Board';
import { api } from '../api';
import type { Bootstrap } from '../api';

interface LearnViewProps {
  bootstrap: Bootstrap;
  onBack: () => void;
}

type Tab = 'lesson' | 'problems' | 'test';

interface Problem {
  id: string;
  title: string;
  level: string;
  size: number;
  komi: number;
  grid: number[];
  hint: string;
}

const LESSONS: { title: string; intro: string; ids: string[] }[] = [
  {
    title: '提子：最后一口气',
    intro: '白棋只剩一口气时，下在那口气上就能把它提掉。数清对方还剩几口气，再落子。',
    ids: ['t01', 't02', 't03'],
  },
  {
    title: '角上的气',
    intro: '角上的棋子只有两个方向可走，气比中间少。先看边线，再找最后一口气。',
    ids: ['t04', 't05', 't06'],
  },
];

const TEST_IDS = ['t01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10'];

/** 本地重放一手（只为把提掉后的盘面画出来，判题仍然在服务端） */
function applyMove(p: Problem, vertex: number): number[] {
  const setup = { black: [] as number[], white: [] as number[] };
  p.grid.forEach((c, i) => {
    if (c === 1) setup.black.push(i);
    if (c === 2) setup.white.push(i);
  });
  const g = new Game({ size: p.size as 9 | 13 | 19, komi: p.komi, setup });
  g.play('B', vertex);
  return Array.from(g.board.grid);
}

const levelHint = (score: number): string => {
  if (score <= 2) return '15 级上下（先练提子与数气）';
  if (score <= 4) return '12 级上下';
  if (score <= 6) return '9 级上下';
  if (score <= 8) return '6 级上下';
  return '3 级上下（这个题库对你太简单了）';
};

export function LearnView({ bootstrap, onBack }: LearnViewProps) {
  const [tab, setTab] = useState<Tab>('lesson');
  const [problems, setProblems] = useState<{ id: string; title: string; level: string }[]>([]);
  const [current, setCurrent] = useState<Problem | null>(null);
  const [grid, setGrid] = useState<number[] | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .tsumegoList()
      .then((res) => setProblems(res.problems))
      .catch(() => setProblems([]));
  }, []);

  const load = useCallback(async (id: string): Promise<void> => {
    setBusy(true);
    try {
      const p = await api.tsumegoGet(id);
      setCurrent(p);
      setGrid([...p.grid]);
      setFeedback(null);
      setSolved(false);
    } catch {
      setFeedback('这道题加载失败了');
    } finally {
      setBusy(false);
    }
  }, []);

  const startQueue = useCallback(
    (ids: string[], from = 0): void => {
      setQueue(ids);
      setStep(from);
      setScore(0);
      setFinished(false);
      void load(ids[from] ?? '');
    },
    [load],
  );

  const next = useCallback((): void => {
    const nextIndex = step + 1;
    if (nextIndex >= queue.length) {
      setFinished(true);
      setCurrent(null);
      return;
    }
    setStep(nextIndex);
    void load(queue[nextIndex]!);
  }, [load, queue, step]);

  const tryMove = async (vertex: number): Promise<void> => {
    if (!current || solved || busy) return;
    setBusy(true);
    try {
      const res = await api.tsumegoTry(current.id, vertex);
      setFeedback(res.message);
      if (res.correct) {
        setGrid(applyMove(current, vertex));
        setSolved(true);
        if (tab === 'test') setScore((s) => s + 1);
        window.setTimeout(() => next(), 1100);
      }
    } catch {
      setFeedback('这一手没送出去，再试一次');
    } finally {
      setBusy(false);
    }
  };

  const startLesson = (index: number): void => {
    setLessonIndex(index);
    startQueue(LESSONS[index]!.ids);
    setTab('lesson');
  };

  const startTest = (): void => {
    setTab('test');
    startQueue(TEST_IDS);
  };

  const progressText = useMemo(() => {
    if (queue.length === 0) return '';
    return tab === 'test' ? `第 ${Math.min(step + 1, queue.length)} / ${queue.length} 题` : `第 ${step + 1} / ${queue.length} 步`;
  }, [queue.length, step, tab]);

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
          <span className="badge">{progressText}</span>
        </div>
        <div className="board-wrap">
          <Board
            size={(current?.size ?? 9) as 9 | 13 | 19}
            grid={grid ?? new Array((current?.size ?? 9) ** 2).fill(0)}
            lastMove={null}
            ownership={null}
            showOwnership={false}
            ghost={null}
            hoverMark={bootstrap.config.ui.hoverMark}
            deadStones={[]}
            interactive={Boolean(current) && !solved}
            onPlace={(v) => void tryMove(v)}
          />
        </div>
      </div>

      <aside className="side">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">教学与题库</span>
            <span className="panel-sub">自建题 · 不计进度</span>
          </div>
          <div className="controls">
            <button className={`btn${tab === 'lesson' ? ' btn-primary' : ''}`} onClick={() => setTab('lesson')}>
              跟做
            </button>
            <button className={`btn${tab === 'problems' ? ' btn-primary' : ''}`} onClick={() => setTab('problems')}>
              题库
            </button>
            <button className={`btn${tab === 'test' ? ' btn-primary' : ''}`} onClick={() => setTab('test')}>
              10 题测级
            </button>
          </div>

          {tab === 'lesson' && (
            <div style={{ marginTop: 10 }}>
              {LESSONS.map((lesson, i) => (
                <button
                  key={lesson.title}
                  className={`room-item${i === lessonIndex ? ' is-active' : ''}`}
                  onClick={() => startLesson(i)}
                  style={{ width: '100%', marginBottom: 6 }}
                >
                  <span>{lesson.title}</span>
                  <span className="hint">{lesson.ids.length} 步</span>
                </button>
              ))}
              <div className="hint" style={{ marginTop: 6 }}>
                {LESSONS[lessonIndex]?.intro}
              </div>
            </div>
          )}

          {tab === 'problems' && (
            <div className="room-list" style={{ marginTop: 10 }}>
              {problems.map((p) => (
                <button key={p.id} className="room-item" onClick={() => startQueue([p.id])}>
                  <span>{p.title}</span>
                  <span className="hint">{p.level}</span>
                </button>
              ))}
              {problems.length === 0 && <div className="hint">题库还没加载出来。</div>}
            </div>
          )}

          {tab === 'test' && (
            <div style={{ marginTop: 10 }}>
              <div className="hint">10 道入门提子题，按第一次落子判分。做完给一个粗略级别建议。</div>
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={startTest}>
                开始测级
              </button>
              {finished && (
                <div className="notice" style={{ marginTop: 10 }}>
                  答对 {score} / {TEST_IDS.length} 题 · 大约 {levelHint(score)}。
                  <br />
                  <span className="hint">这只是 10 道提子题，不等于真实段位，仅供参考。</span>
                </div>
              )}
            </div>
          )}

          {current && (
            <div style={{ marginTop: 12 }}>
              <div className="panel-head" style={{ padding: 0 }}>
                <span className="panel-title" style={{ fontSize: 15 }}>
                  {current.title}
                </span>
                <span className="panel-sub">{current.level}</span>
              </div>
              {feedback && <div className={`notice${solved ? '' : ' hint-warn'}`}>{feedback}</div>}
              {!feedback && <div className="hint">轮到黑棋：点棋盘落子。</div>}
              {solved && (
                <button className="btn" style={{ marginTop: 8 }} onClick={next}>
                  下一题
                </button>
              )}
              {!solved && feedback && <div className="hint">提示：{current.hint}</div>}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
