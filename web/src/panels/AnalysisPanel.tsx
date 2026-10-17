import { CAP_NOTES, PASS, levelCn, vertexToGtp, type Caps, type AnalysisResult } from '../types';

export interface AnalysisPanelProps {
  caps: Caps;
  analysis: AnalysisResult | null;
  unavailableReason: string | null;
  loading: boolean;
  showOwnership: boolean;
  onToggleOwnership: () => void;
  onHover: (vertex: number | null) => void;
  onPick: (vertex: number) => void;
  canPlay: boolean;
}

export function AnalysisPanel(props: AnalysisPanelProps) {
  const { caps, analysis, unavailableReason, loading, showOwnership, onToggleOwnership, onHover, onPick, canPlay } =
    props;

  const best = analysis?.candidates[0];
  const winrate = best ? Math.round(best.winrate * 1000) / 10 : null;
  const lead = best ? Math.round(best.scoreLead * 10) / 10 : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">形势</span>
        <span className="panel-sub">
          {loading ? '推算中…' : analysis ? `${analysis.rootVisits} visits · ${analysis.elapsedMs}ms` : '未分析'}
        </span>
      </div>

      {!caps.showWinrate ? (
        <div className="hint">
          {CAP_NOTES.showWinrate}。
          <br />
          {CAP_NOTES.showComment}。
        </div>
      ) : unavailableReason ? (
        <div className="hint">{unavailableReason}</div>
      ) : (
        <>
          <div className="stat-row">
            <span className="stat-key">胜率</span>
            <span className="stat-val">{winrate === null ? '—' : `${winrate}%`}</span>
          </div>
          <div className="stat-row">
            <span className="stat-key">目差</span>
            <span className="stat-val" style={{ color: lead !== null && lead < 0 ? 'var(--danger)' : undefined }}>
              {lead === null ? '—' : `${lead > 0 ? '+' : ''}${lead}`}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 6px' }}>
            <span className="panel-sub">候选点（点一下看变化）</span>
            <button className="linkish" onClick={onToggleOwnership} style={{ fontSize: 11 }}>
              {showOwnership ? '关闭形势图' : '开形势图 (F)'}
            </button>
          </div>

          <div className="candidates" onMouseLeave={() => onHover(null)}>
            {(analysis?.candidates ?? []).slice(0, 5).map((c) => (
              <button
                key={c.move}
                className="candidate"
                onMouseEnter={() => onHover(c.vertex)}
                onClick={() => (canPlay && c.vertex !== PASS ? onPick(c.vertex) : onHover(c.vertex))}
                title={canPlay ? '点一下直接落子' : '点一下预览变化'}
              >
                <span className="move">{c.move}</span>
                <span className="bar">
                  <span style={{ width: `${Math.min(100, Math.max(2, c.visits ? (c.visits / (analysis?.rootVisits || c.visits)) * 100 : 2))}%` }} />
                </span>
                <span className="num">{Math.round(c.winrate * 100)}%</span>
              </button>
            ))}
            {!loading && (!analysis || analysis.candidates.length === 0) && (
              <div className="hint">还没有候选点。落一手，或等引擎算完。</div>
            )}
          </div>

          {best && best.pv.length > 1 && (
            <div className="hint" style={{ marginTop: 10 }}>
              主变化：{best.pv.slice(0, 6).join(' → ')}
            </div>
          )}
          {analysis && (
            <div className="hint" style={{ marginTop: 6, opacity: 0.7 }}>
              分析固定用主模型跑（{analysis.source === 'katago' ? 'KataGo' : '离线'}）
            </div>
          )}
        </>
      )}
    </section>
  );
}
