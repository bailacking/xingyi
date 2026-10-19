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

type Item = { id: string; title: string; level: string };

const LESSONS: { title: string; intro: string; pick: (list: Item[]) => string[] }[] = [
  {
    title: '提子：最后一口气',
    intro: '白棋只剩一口气时，下在那口气上就能把它提掉。数清对方还剩几口气，再落子。',
    // 入门题里挑最简单的 3 道（1~2 子）
    pick: (list) => list.filter((p) => p.level === '入门').slice(0, 3).map((p) => p.id),
  },
  {
    title: '角上的气',
    intro: '角上的棋子只有两个方向可走，气比中间少。先看边线，再找最后一口气。',
    pick: (list) => list.filter((p) => p.level === '进阶').slice(0, 3).map((p) => p.id),
  },
];

/** 测级固定 10 题，按题库顺序均匀取样（覆盖各个难度，而不是只考最简单的） */
const TEST_SIZE = 10;

function pickEven(list: Item[], n = TEST_SIZE): string[] {
  if (list.length === 0) return [];
  const step = list.length / Math.min(n, list.length);
  return Array.from({ length: Math.min(n, list.length) }, (_, i) => list[Math.floor(i * step)]!.id);
}

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
  const [problems, setProblems] = useState<Item[]>([]);
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

  const lessonIds = useMemo(() => LESSONS.map((l) => l.pick(problems)), [problems]);
  const testIds = useMemo(() => pickEven(problems), [problems]);

  const startLesson = (index: number): void => {
    setLessonIndex(index);
    startQueue(lessonIds[index] ?? []);
    setTab('lesson');
  };

  const startTest = (): void => {
    setTab('test');
    setScore(0);
    setFinished(false);
    startQueue(testIds);
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
              测级（10 题）
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
                  <span className="hint">{(lessonIds[i] ?? []).length} 步</span>
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
              {problems.length > 0 && (
                <div className="hint" style={{ marginTop: 4 }}>
                  共 {problems.length} 题，每题都由规则引擎验算过（白棋确实只剩一口气、正解确实提得掉）。
                </div>
              )}
            </div>
          )}

          {tab === 'test' && (
            <div style={{ marginTop: 10 }}>
              <div className="hint">
                从 {problems.length} 道题里均匀抽 10 道，按第一次落子判分，做完给一个粗略级别建议。
              </div>
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={startTest}>
                开始测级
              </button>
              {finished && (
                <div className="notice" style={{ marginTop: 10 }}>
                  答对 {score} / {testIds.length} 题 · 大约 {levelHint(score)}。
                  <br />
                  <span className="hint">这只是提子题，不等于真实段位，仅供参考。</span>
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
