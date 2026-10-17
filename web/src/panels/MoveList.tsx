import { PASS, vertexToGtp, type Color, type MoveRecord } from '../types';

export interface MoveListProps {
  size: number;
  moves: MoveRecord[];
  /** 允许点击跳到该手（自在模式） */
  onJump?: (ply: number) => void;
}

export function MoveList({ size, moves, onJump }: MoveListProps) {
  const rows = moves.map((m, i) => ({
    ply: i + 1,
    color: m.color as Color,
    label: m.vertex === PASS ? '停' : vertexToGtp(size, m.vertex),
    captured: m.captured.length,
  }));

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">手数</span>
        <span className="panel-sub">{moves.length} 手</span>
      </div>
      {rows.length === 0 ? (
        <div className="hint">还没有落子。</div>
      ) : (
        <div className="move-list">
          {rows.map((r) => (
            <button
              key={r.ply}
              className={`move-item${onJump ? ' clickable' : ''}`}
              onClick={() => onJump?.(r.ply)}
              disabled={!onJump}
              title={onJump ? '回到这手之前' : undefined}
            >
              <span className="idx">{r.ply}</span>
              <span style={{ color: r.color === 'B' ? 'var(--text)' : 'var(--text-dim)' }}>
                {r.color === 'B' ? '黑' : '白'} {r.label}
                {r.captured ? ` 提${r.captured}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
