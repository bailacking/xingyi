import { useMemo } from 'react';
import type { MoveRecord, ReviewPoint, ReviewResult } from '../types';
import '../styles/review.css';

interface ReviewPanelProps {
  result: ReviewResult;
  ply: number;
  moves: MoveRecord[];
  onPick: (ply: number) => void;
  onExit: () => void;
  /** 复盘是分块算的：算的过程中可以喊停，已算出的部分保留 */
  onCancel?: () => void;
}

const LABEL_TEXT: Record<ReviewPoint['label'], string> = {
  good: '好',
  normal: '一般',
  mistake: '失误',
  unknown: '—',
};

const LABEL_CLASS: Record<ReviewPoint['label'], string> = {
  good: 'is-good',
  normal: 'is-normal',
  mistake: 'is-bad',
  unknown: 'is-unknown',
};

/** 胜率曲线：横轴手数，纵轴黑方胜率 */
function WinrateChart({
  points,
  ply,
  onPick,
}: {
  points: ReviewPoint[];
  ply: number;
  onPick: (ply: number) => void;
}) {
  const W = 300;
  const H = 96;
  const pad = 6;
  const n = points.length;
  const x = (i: number): number => (n <= 1 ? pad : pad + (i / (n - 1)) * (W - pad * 2));
  const y = (wr: number): number => pad + (1 - wr) * (H - pad * 2);

  const path = useMemo(() => {
    const segs: string[] = [];
    let started = false;
    points.forEach((p, i) => {
      if (p.winrateBlack === null) {
        started = false;
        return;
      }
      const cmd = started ? 'L' : 'M';
      segs.push(`${cmd}${x(i).toFixed(1)},${y(p.winrateBlack).toFixed(1)}`);
      started = true;
    });
    return segs.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  return (
    <svg className="review-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="胜率曲线">
      <line x1={pad} y1={y(0.5)} x2={W - pad} y2={y(0.5)} stroke="var(--line)" strokeDasharray="3 4" />
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth={1.6} />
      {points.map((p, i) =>
        p.winrateBlack === null ? null : (
          <circle
            key={p.ply}
            cx={x(i)}
            cy={y(p.winrateBlack)}
            r={p.ply === ply ? 3.6 : p.label === 'mistake' ? 2.6 : 1.8}
            fill={
              p.ply === ply
                ? 'var(--accent)'
                : p.label === 'mistake'
                  ? 'var(--danger)'
                  : p.label === 'normal'
                    ? 'var(--text-dim)'
                    : 'var(--ok)'
            }
            style={{ cursor: 'pointer' }}
            onClick={() => onPick(p.ply)}
          />
        ),
      )}
    </svg>
  );
}

export function ReviewPanel({ result, ply, moves, onPick, onExit, onCancel }: ReviewPanelProps) {
  const current = result.points.find((p) => p.ply === ply) ?? null;
  const mv = ply > 0 ? moves[ply - 1] : null;
  const mistakes = result.points.filter((p) => p.label === 'mistake');
  const progress = result.progress;
  const running = progress?.running ?? false;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 100;
  const byColor = result.summary.byColor;
  const colorOf = (p: ReviewPoint): 'B' | 'W' => moves[p.ply - 1]?.color ?? 'B';

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">复盘</span>
        <span className="panel-sub">
          {result.size} 路 · {result.points.length}
          {running && progress ? ` / ${progress.total - 1}` : ''} 手
        </span>
      </div>

      {progress && running && (
        <div className="review-progress">
          <div className="review-progress-head">
            <span>
              正在分析 {progress.done} / {progress.total} 个局面
            </span>
            <span className="review-elapsed">{Math.round(progress.elapsedMs / 1000)} 秒</span>
          </div>
          <div className="review-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="review-progress-foot">
            <span className="hint">先算的部分已经能点开看，不用等全部算完</span>
            <button className="btn" onClick={onCancel}>
              中断复盘
            </button>
          </div>
        </div>
      )}

      {progress && !running && progress.cancelled && (
        <div className="review-stopped">
          已中断：只复盘了前 {result.points.length} 手，后面的手数没有结论。
        </div>
      )}

      <WinrateChart points={result.points} ply={ply} onPick={onPick} />
      <div className="review-legend">
        <span className="is-good">● 好</span>
        <span className="is-normal">● 一般</span>
        <span className="is-bad">● 失误</span>
        <span className="hint">点击曲线或手数跳转</span>
      </div>

      <div className="review-summary">
        <span className="review-color is-black">
          黑方
          <b>{byColor.B.mistake}</b> 失误
        </span>
        <span className="review-color is-white">
          白方
          <b>{byColor.W.mistake}</b> 失误
        </span>
        <span>
          好 <b>{result.summary.good}</b>
        </span>
        <span>
          一般 <b>{result.summary.normal}</b>
        </span>
        <span className="is-bad">
          失误 <b>{result.summary.mistake}</b>
        </span>
      </div>

      {(byColor.B.mistake > 0 || byColor.W.mistake > 0) && (
        <table className="review-bycolor">
          <thead>
            <tr>
              <th />
              <th>好</th>
              <th>一般</th>
              <th>失误</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="is-black">黑方</th>
              <td>{byColor.B.good}</td>
              <td>{byColor.B.normal}</td>
              <td className="is-bad">{byColor.B.mistake}</td>
            </tr>
            <tr>
              <th className="is-white">白方</th>
              <td>{byColor.W.good}</td>
              <td>{byColor.W.normal}</td>
              <td className="is-bad">{byColor.W.mistake}</td>
            </tr>
          </tbody>
        </table>
      )}

      {current && (
        <div className="review-current">
          <div className="stat-row">
            <span className="stat-key">第 {current.ply} 手</span>
            <span className="stat-val">
              {mv ? (mv.color === 'B' ? '黑' : '白') : '—'}
              {mv?.name ? ` ${mv.name}` : ''} · {LABEL_TEXT[current.label]}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-key">比最佳着法</span>
            <span className="stat-val">
              {current.loss === null ? '—' : current.loss === 0 ? '最佳' : `亏 ${current.loss} 目`}
              {current.lossWinrate !== null && current.lossWinrate > 0.005
                ? ` · 胜率 −${Math.round(current.lossWinrate * 100)}%`
                : ''}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-key">黑方胜率</span>
            <span className="stat-val">
              {current.winrateBlack === null ? '—' : `${Math.round(current.winrateBlack * 100)}%`}
            </span>
          </div>
        </div>
      )}

      <div className="review-grid">
        {result.points.map((p) => (
          <button
            key={p.ply}
            className={`review-chip ${LABEL_CLASS[p.label]} is-${colorOf(p) === 'B' ? 'black' : 'white'}${
              p.ply === ply ? ' is-active' : ''
            }`}
            onClick={() => onPick(p.ply)}
            title={`${colorOf(p) === 'B' ? '黑' : '白'} 第 ${p.ply} 手 · ${
              p.loss === null ? '这手不在候选里' : `亏 ${p.loss} 目`
            }`}
          >
            {p.ply}
          </button>
        ))}
      </div>

      {mistakes.length > 0 && (
        <div className="review-mistakes">
          {mistakes.slice(0, 8).map((m) => (
            <button
              key={m.ply}
              className={`review-mistake is-${colorOf(m) === 'B' ? 'black' : 'white'}`}
              onClick={() => onPick(m.ply)}
            >
              {colorOf(m) === 'B' ? '黑' : '白'} {m.ply}
              {m.loss === null ? '' : ` · 亏 ${m.loss} 目`}
            </button>
          ))}
          {mistakes.length > 8 && <span className="hint">等 {mistakes.length} 手</span>}
        </div>
      )}

      <div className="controls" style={{ marginTop: 10 }}>
        <button className="btn btn-primary" onClick={onExit}>
          退出复盘
        </button>
      </div>
      {result.truncated && <div className="hint">棋盘太长，只复盘了前 200 手。</div>}
    </section>
  );
}
