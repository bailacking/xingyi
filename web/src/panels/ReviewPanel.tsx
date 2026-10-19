import { useMemo } from 'react';
import type { MoveRecord, ReviewPoint, ReviewResult } from '../types';

interface ReviewPanelProps {
  result: ReviewResult;
  ply: number;
  moves: MoveRecord[];
  onPick: (ply: number) => void;
  onExit: () => void;
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

export function ReviewPanel({ result, ply, moves, onPick, onExit }: ReviewPanelProps) {
  const current = result.points.find((p) => p.ply === ply) ?? null;
  const mv = ply > 0 ? moves[ply - 1] : null;
  const mistakes = result.points.filter((p) => p.label === 'mistake');

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">复盘</span>
        <span className="panel-sub">
          {result.size} 路 · {result.points.length} 手
        </span>
      </div>

      <WinrateChart points={result.points} ply={ply} onPick={onPick} />
      <div className="review-legend">
        <span className="is-good">● 好</span>
        <span className="is-normal">● 一般</span>
        <span className="is-bad">● 失误</span>
        <span className="hint">点击曲线或手数跳转</span>
      </div>

      <div className="review-summary">
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
            className={`review-chip ${LABEL_CLASS[p.label]}${p.ply === ply ? ' is-active' : ''}`}
            onClick={() => onPick(p.ply)}
            title={p.loss === null ? '这手不在候选里' : `亏 ${p.loss} 目`}
          >
            {p.ply}
          </button>
        ))}
      </div>

      {mistakes.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          失误集中在第 {mistakes.slice(0, 8).map((m) => m.ply).join('、')}
          {mistakes.length > 8 ? ' 手等' : ' 手'}。
        </div>
      )}

      <div className="controls" style={{ marginTop: 10 }}>
        <button className="btn btn-primary" onClick={onExit}>
          退出复盘
        </button>
      </div>
      {result.truncated && <div className="hint">棋盘太长，只复盘了前 220 手。</div>}
    </section>
  );
}
