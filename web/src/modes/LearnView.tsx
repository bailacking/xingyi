import { useEffect, useRef, useState } from 'react';
import { BLACK, WHITE, scoreText } from '@xingyi/rules';
import { Board } from '../board/Board';
import { MistakeNotebookView } from './MistakeNotebookView';
import {
  RULES_LESSONS, lessonMarkers, lessonTask, passLesson, playLessonPoint, scoreLesson, startLesson,
} from './rulesCourse';
import '../styles/learn.css';

interface LearnViewProps {
  hoverMark: 'square' | 'ghost';
  onBack: () => void;
  onPlay: () => void;
  engineReady: boolean;
  onEngineSettings: () => void;
}

export function LearnView({ hoverMark, onBack, onPlay, engineReady, onEngineSettings }: LearnViewProps) {
  const [index, setIndex] = useState(0);
  const [reached, setReached] = useState(0);
  const scrollRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lesson = RULES_LESSONS[index]!;
  const final = index === RULES_LESSONS.length - 1;
  const [state, setState] = useState(() => startLesson(lesson.id));
  const [showHint, setShowHint] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);

  const { game } = state;
  const scoring = lesson.id === 'score';
  const needsPass = scoring && game.status === 'playing';
  const needsDead = scoring && game.status === 'scoring';
  const feedback = state.feedback || (needsPass ? '当前轮到黑方。' : '');
  const score = scoring && state.complete ? game.score() : null;
  const grid = Array.from(game.board.grid);
  const ownership = score ? grid.map(() => 0) : null;
  if (score && ownership) {
    for (const v of game.deadStones) grid[v] = 0;
    for (const v of score.blackTerritory) ownership[v] = 1;
    for (const v of score.whiteTerritory) ownership[v] = -1;
  }

  const goTo = (next: number) => {
    setIndex(next);
    setShowHint(false);
    setState(startLesson(RULES_LESSONS[next]!.id));
    setReached(Math.max(reached, next));
  };

  useEffect(() => {
    if (index === 0 && reached === 0) return;
    scrollRef.current?.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [index, reached]);

  if (notebookOpen) {
    return <MistakeNotebookView hoverMark={hoverMark} onBack={() => setNotebookOpen(false)} />;
  }

  return (
    <main className="learn-screen" ref={scrollRef}>
      <div className="learn-inner">
        <header className="learn-header">
          <button className="linkish" onClick={onBack}>← 返回首页</button>
          <div className="learn-heading">
            <button className="btn" onClick={() => setNotebookOpen(true)}>我的错题</button>
            <div>
              <h1>围棋入门</h1>
              <p className="hint">零基础 · 约 10 分钟</p>
            </div>
          </div>
        </header>

        <nav className="learn-steps" aria-label="课程目录">
          {RULES_LESSONS.map((item, i) => (
            <button
              key={item.id}
              className="btn"
              aria-current={i === index ? 'step' : undefined}
              disabled={i > reached}
              onClick={() => goTo(i)}
            >
              {i + 1}. {item.title}
            </button>
          ))}
        </nav>

        <div className="learn-layout">
          <div className="learn-instructions">
            <section className="panel">
              <p className="hint learn-progress">第 {index + 1} 课 / 共 {RULES_LESSONS.length} 课</p>
              <h2 ref={headingRef} tabIndex={-1}>{lesson.title}</h2>
              <p>{lesson.explanation}</p>
              {!state.complete && <p className="learn-task">{lessonTask(lesson.id, state.stage)}</p>}
              {lesson.id === 'turns' && <p className="hint">胜负看终局谁占得多。下面几课会带你练习提子和数子。</p>}
            </section>
          </div>
          <div className="board-wrap learn-board">
            <Board
              size={game.size}
              grid={grid}
              lastMove={game.lastMove}
              markers={lessonMarkers(lesson.id, state, showHint)}
              interactive={!scoring && !state.complete}
              onPlace={(v) => setState(playLessonPoint(lesson.id, state, v))}
              onToggleDead={needsDead ? (v) => setState(playLessonPoint(lesson.id, state, v)) : undefined}
              deadStones={needsDead ? state.selected : undefined}
              ownership={ownership}
              showOwnership={score !== null}
              hoverMark={hoverMark}
            />
          </div>
          <section className="panel learn-response" aria-label="练习反馈">
            <div role="status" aria-atomic="true" className="learn-feedback">
              {feedback}
            </div>
            <div className="learn-outcome">
              {score && (
                <div className="learn-score">
                  <strong>{scoreText(score)}</strong>
                  <dl>
                    <div><dt>黑方</dt><dd>{grid.filter((c) => c === BLACK).length} 颗活子 + {score.blackTerritory.length} 个空点 = {score.blackArea}</dd></div>
                    <div><dt>白方</dt><dd>{grid.filter((c) => c === WHITE).length} 颗活子 + {score.whiteTerritory.length} 个空点 + {score.komi} 贴目 = {score.whiteArea + score.komi}</dd></div>
                  </dl>
                  <p>数子时，各方算自己的活子与围住的空点。黑棋先下，所以星弈默认给白方加 {score.komi} 目。双方共有的空点不拉开差距，示范盘把它们留白。已经提走的棋子不再加分。</p>
                  <p>{engineReady ? '六课学完了。和 KataGo 下第一盘 9 路棋，赛后挑一手来练。' : '六课学完了。准备好 KataGo，就能下第一盘 9 路棋并练习复盘。'}</p>
                  <a className="hint" href="https://wqwh.weiqi.org.cn/rules/" target="_blank" rel="noreferrer">中国围棋协会 · 围棋规则</a>
                </div>
              )}
              <div className="learn-actions">
                <button className="btn" onClick={() => goTo(index)}>重练本课</button>
                {!state.complete && (lesson.id === 'liberties' || lesson.id === 'capture') && (
                  <button className="btn" aria-pressed={showHint} onClick={() => setShowHint(!showHint)}>
                    {showHint ? '收起提示' : '显示提示'}
                  </button>
                )}
                {needsPass && <button className="btn btn-primary" onClick={() => setState(passLesson(state))}>{game.toPlay === 'B' ? '黑方' : '白方'}停一手</button>}
                {needsDead && <button className="btn btn-primary" disabled={!state.selected.length} onClick={() => setState(scoreLesson(state))}>确认数子</button>}
                {!scoring && <button className="btn btn-primary" disabled={!state.complete} onClick={() => goTo(index + 1)}>下一课</button>}
                {final && state.complete && (
                  <button className="btn btn-primary" onClick={engineReady ? onPlay : onEngineSettings}>
                    {engineReady ? '和 KataGo 下第一盘' : '前往设置 · 安装 KataGo'}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
