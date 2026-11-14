import { useEffect, useRef, useState } from 'react';
import { checkExerciseMove, exercisePosition } from '@xingyi/rules';
import { vertexToGtp, type FirstGameExercise, type FirstGameExerciseKind, type TeachingAttempt } from '@xingyi/shared';
import { Board } from '../board/Board';
import { ApiError } from '../api';
import '../styles/learn.css';
import '../styles/first-game-review.css';

export const EXERCISE_TITLES: Record<FirstGameExerciseKind, string> = {
  save: '给棋块多留一口气',
  capture: '提走这块棋',
  connect: '把两块棋连起来',
  katago: '试下一手，对照变化',
};

interface FirstGameReviewProps {
  exercise: FirstGameExercise;
  hoverMark: 'square' | 'ghost';
  onBack: () => void;
  save?: { saved: boolean; run: () => Promise<void> };
  onPracticed?: (vertex: number) => Promise<void>;
  onTry?: (vertex: number) => Promise<TeachingAttempt>;
  fromNotebook?: boolean;
}

export function FirstGameReviewView({ exercise, hoverMark, onBack, save, onPracticed, onTry, fromNotebook }: FirstGameReviewProps) {
  const [originalStep, setOriginalStep] = useState(0);
  const [variationStep, setVariationStep] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [trial, setTrial] = useState<TeachingAttempt | null>(null);
  const [trialStep, setTrialStep] = useState(0);
  const [pendingVertex, setPendingVertex] = useState<number | null>(null);
  const request = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    return () => { request.current++; };
  }, []);

  const game = exercisePosition(exercise);
  const color = game.toPlay;
  const turn = color === 'B' ? '黑' : '白';
  const other = color === 'B' ? '白' : '黑';
  const count = exercise.stones.length;
  const ply = exercise.prefix.length + 1;
  const coordinate = (vertex: number) => vertexToGtp(exercise.size, vertex);
  const comparison = exercise.comparison;
  const task = comparison ? '先在实战落子前试下一手，再对照 KataGo 的推荐变化。'
    : exercise.kind === 'capture'
    ? `堵住圈出的${other}棋最后一口气，提走这块棋。`
    : exercise.kind === 'connect'
      ? `把圈出的${turn}棋接到附近的同色棋上，让它多一口气。`
      : `圈出的${turn}棋只剩一口气。下一手，让对手提不走它。`;

  if (trialStep && trial) {
    for (const move of trial.variation.slice(0, trialStep)) game.play(move.color, move.vertex);
  } else if (originalStep) {
    for (const move of exercise.original.slice(0, originalStep)) game.play(move.color, move.vertex);
  } else if (variationStep && comparison) {
    for (const move of comparison.variation.slice(0, variationStep)) game.play(move.color, move.vertex);
  } else if (answer !== null) {
    game.play(color, answer);
  }

  const reset = () => {
    setOriginalStep(0);
    setVariationStep(0);
    setTrialStep(0);
    setTrial(null);
    setAnswer(null);
    setHint(false);
    setFeedback('');
    setRecordError('');
  };

  const lead = (value: number) => value === 0 ? '大致均势' : `${value > 0 ? '领先' : '落后'}约 ${Math.abs(value).toFixed(1)} 目`;
  const activeLine = trialStep ? trial?.variation : originalStep ? exercise.original : comparison?.variation;
  const activeStep = originalStep || variationStep || trialStep;
  const phaseMove = activeLine?.[activeStep - 1];
  const reviewingLine = activeStep > 0;
  const revealComparison = comparison && (reviewingLine || answer !== null || hint || trial !== null);
  const phaseCaptures = reviewingLine ? game.moves.at(-1)?.captured.length ?? 0 : 0;
  const evaluating = pendingVertex !== null;

  const tryMove = async (vertex: number) => {
    if (evaluating) return;
    if (!onTry) {
      const result = checkExerciseMove(exercise, vertex);
      setFeedback(result.message);
      if (result.correct) {
        setAnswer(vertex);
        if (onPracticed) void record(() => onPracticed(vertex));
      }
      return;
    }
    const preview = game.preview(color, vertex);
    if (!preview.ok) { setFeedback(preview.message ?? '这一手不能下'); return; }
    const id = ++request.current;
    setPendingVertex(vertex);
    setFeedback('');
    try {
      const result = await onTry(vertex);
      if (request.current !== id) return;
      setTrial(result);
      setTrialStep(1);
    } catch (error) {
      if (request.current === id) setFeedback(error instanceof ApiError ? error.message : '暂时无法分析这一步，请再试一次。');
    } finally {
      if (request.current === id) setPendingVertex(null);
    }
  };

  const record = async (action: () => Promise<void>) => {
    setRecording(true);
    setRecordError('');
    try {
      await action();
    } catch (error) {
      setRecordError(error instanceof ApiError ? error.message : '保存失败，请重试。');
    } finally {
      setRecording(false);
    }
  };

  return (
    <main className="learn-screen first-game-review">
      <div className="learn-inner">
        <header className="learn-header">
          <button className="linkish" disabled={recording} onClick={onBack}>← {fromNotebook ? '返回错题' : '返回结算'}</button>
          <h1 ref={titleRef} tabIndex={-1}>看一手，试一次</h1>
        </header>
        <div className="learn-layout">
          <section className="panel learn-instructions">
            <p className="hint learn-progress">第 {ply} 手 · 你执{turn}</p>
            <h2>{EXERCISE_TITLES[exercise.kind]}</h2>
            <p className="learn-task">{task}</p>
          </section>
          <div className="board-wrap learn-board">
            <Board
              size={game.size}
              grid={Array.from(game.board.grid)}
              lastMove={game.lastMove}
              markers={originalStep >= 2 || (answer !== null && exercise.kind === 'capture') ? undefined
                : [...exercise.stones, ...(pendingVertex !== null ? [pendingVertex] : hint && answer === null && !reviewingLine ? [exercise.answer] : [])]}
              interactive={!reviewingLine && answer === null && !evaluating}
              hoverMark={hoverMark}
              onPlace={(vertex) => void tryMove(vertex)}
            />
          </div>
          <section className="panel learn-response" aria-label="复盘反馈">
            <div className="learn-feedback" role="status" aria-atomic="true">
              {comparison && phaseMove && reviewingLine && `${trialStep ? '你的试下' : originalStep ? '实战' : 'KataGo 推演'} · 第 ${activeStep} / ${activeLine?.length} 手 · ${phaseMove.color === color ? '你方' : '对手'}${phaseMove.vertex < 0 ? '停一手' : `下在 ${coordinate(phaseMove.vertex)}`}${phaseCaptures ? `，提走 ${phaseCaptures} 颗棋子` : ''}。`}
              {!comparison && originalStep === 1 && `实战里，你下在 ${coordinate(exercise.original[0].vertex)}。圈出的棋仍然在盘上。`}
              {!comparison && originalStep === 2 && `对手接着下在 ${coordinate(exercise.original[1]!.vertex)}。${exercise.kind === 'capture' ? '这块棋接出去后有了更多的气，已经不能一手提走。' : `对手堵住最后一口气，提走了你 ${count} 颗棋子。`}`}
              {!reviewingLine && (pendingVertex !== null ? `KataGo 正在分析你下的 ${coordinate(pendingVertex)}…` : feedback || (hint ? `试着下在圈出的空点 ${coordinate(exercise.answer)}。` : ''))}
            </div>
            <div className="learn-outcome">
              {revealComparison && (
                <div className="learn-score" aria-label="KataGo 目差对照">
                  <strong>推荐着法预计好约 {(comparison.suggested - comparison.played).toFixed(1)} 目</strong>
                  <dl>
                    {trial && <div><dt>试下 {coordinate(trial.variation[0]!.vertex)}</dt><dd>{lead(trial.lead)}</dd></div>}
                    <div><dt>实战 {coordinate(exercise.original[0].vertex)}</dt><dd>{lead(comparison.played)}</dd></div>
                    <div><dt>推荐 {coordinate(exercise.answer)}</dt><dd>{lead(comparison.suggested)}</dd></div>
                  </dl>
                  {trial && <p>{trial.closeToSuggested ? '这手达到本题的练习目标。' : `你的试下比推荐着法少约 ${(comparison.suggested - trial.lead).toFixed(1)} 目。看看对手会怎么应，也可以回到原处再试。`}</p>}
                  <p className="hint">目差以你执的颜色为准。逐手切换，看实战应手和 KataGo 推演的差别。</p>
                </div>
              )}
              {recordError && <p className="hint hint-warn" role="alert">{recordError}</p>}
              <div className="learn-actions">
                {save && (
                  <button className="btn" disabled={recording || save.saved} onClick={() => void record(save.run)}>
                    {save.saved ? '已加入我的错题' : recording ? '正在保存…' : '加入我的错题'}
                  </button>
                )}
                {onPracticed && recordError && answer !== null && (
                  <button className="btn" disabled={recording} onClick={() => void record(() => onPracticed(answer))}>重试保存练习记录</button>
                )}
                {comparison ? (
                  <>
                    {!reviewingLine && answer === null && <button className="btn" disabled={evaluating} aria-pressed={hint} onClick={() => { setHint(!hint); setFeedback(''); }}>{hint ? '收起提示' : '显示提示'}</button>}
                    {(reviewingLine || answer !== null) && <button className="btn" disabled={recording} onClick={reset}>回到落子前</button>}
                    {trial && <button className="btn" aria-pressed={trialStep > 0} onClick={() => {
                      setOriginalStep(0);
                      setVariationStep(0);
                      setTrialStep(Math.min(trial.variation.length, activeStep || 1));
                    }}>看我的试下</button>}
                    <button className="btn" disabled={evaluating} aria-pressed={originalStep > 0} onClick={() => {
                      setTrialStep(0);
                      setVariationStep(0);
                      setOriginalStep(Math.min(exercise.original.length, activeStep || 1));
                    }}>看实战变化</button>
                    <button className="btn" disabled={evaluating} aria-pressed={variationStep > 0} onClick={() => {
                      setTrialStep(0);
                      setOriginalStep(0);
                      setVariationStep(Math.min(comparison.variation.length, activeStep || 1));
                    }}>看推荐变化</button>
                    {reviewingLine && activeLine && activeStep < activeLine.length && (
                      <button className="btn btn-primary" onClick={() => trialStep ? setTrialStep(trialStep + 1)
                        : originalStep ? setOriginalStep(originalStep + 1) : setVariationStep(variationStep + 1)}>下一手</button>
                    )}
                  </>
                ) : originalStep ? (
                  <>
                    <button className="btn" disabled={recording} onClick={reset}>回到落子前</button>
                    {originalStep === 1 && <button className="btn btn-primary" onClick={() => setOriginalStep(2)}>看对手怎么下</button>}
                  </>
                ) : (
                  <>
                    {answer === null
                      ? <button className="btn" aria-pressed={hint} onClick={() => { setHint(!hint); setFeedback(''); }}>{hint ? '收起提示' : '显示提示'}</button>
                      : <button className="btn" disabled={recording} onClick={reset}>再试一次</button>}
                    <button className={answer === null ? 'btn' : 'btn btn-primary'} onClick={() => setOriginalStep(1)}>看实战两手</button>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
