import { useEffect, useMemo, useRef, useState } from 'react';
import { GTP_LETTERS, starPoints } from '@xingyi/shared';

const VIEW = 1000;
const PAD = 64;

export interface BoardProps {
  size: number;
  grid: number[];
  lastMove?: number | null;
  /** 形势图：[-1,1]，1=黑 */
  ownership?: number[] | null;
  showOwnership?: boolean;
  /** 变化预览（幽灵子） */
  ghost?: { vertex: number; order: number }[] | null;
  deadStones?: number[];
  /** 是否允许点棋盘落子 */
  interactive?: boolean;
  onPlace?: (vertex: number) => void;
  /** 结算阶段：点棋子切换死子 */
  onToggleDead?: (vertex: number) => void;
  /**
   * 落子虚影形态：
   * - square 小方块（默认）：色块够实、换任何主题都看得清
   * - ghost  棋子虚影：像放了一颗半透明棋子，更拟真但浅色棋盘上容易发虚
   */
  hoverMark?: 'square' | 'ghost';
}

export function Board(props: BoardProps) {
  const {
    size,
    grid,
    lastMove,
    ownership,
    showOwnership,
    ghost,
    deadStones,
    interactive,
    onPlace,
    onToggleDead,
    hoverMark = 'square',
  } = props;
  const [hover, setHover] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);

  // 棋盘必须是正方形，且不能把侧栏/窗口撑破：量父容器，取短边
  useEffect(() => {
    const host = frameRef.current?.parentElement;
    if (!host) return;
    const update = (): void => {
      const r = host.getBoundingClientRect();
      setSide(Math.max(160, Math.floor(Math.min(r.width, r.height))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const step = (VIEW - PAD * 2) / (size - 1);
  const px = (v: number): number => PAD + (v % size) * step;
  const py = (v: number): number => PAD + Math.floor(v / size) * step;
  const stars = useMemo(() => starPoints(size), [size]);
  const deadSet = useMemo(() => new Set(deadStones ?? []), [deadStones]);
  const ghostMap = useMemo(() => new Map((ghost ?? []).map((g) => [g.vertex, g.order])), [ghost]);
  const stoneR = step * 0.468;
  const lineW = size >= 19 ? 1.5 : size === 13 ? 1.9 : 2.4;

  return (
    <div className="board-frame" ref={frameRef} style={side ? { width: side, height: side } : undefined}>
    <svg
      className={`board-svg${interactive || onToggleDead ? '' : ' is-locked'}`}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="grid"
      aria-label={`${size} 路棋盘`}
    >
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="0.45" y2="1">
          <stop offset="0%" stopColor="var(--board)" />
          <stop offset="58%" stopColor="var(--board)" />
          <stop offset="100%" stopColor="var(--board-edge)" />
        </linearGradient>
        <radialGradient id="stoneBlack" cx="36%" cy="30%" r="72%">
          <stop offset="0%" stopColor="var(--stone-black-highlight)" />
          <stop offset="45%" stopColor="var(--stone-black)" />
          <stop offset="100%" stopColor="var(--stone-black-edge)" />
        </radialGradient>
        <radialGradient id="stoneWhite" cx="36%" cy="28%" r="74%">
          <stop offset="0%" stopColor="var(--stone-white-highlight)" />
          <stop offset="62%" stopColor="var(--stone-white)" />
          <stop offset="100%" stopColor="var(--stone-white-edge)" />
        </radialGradient>
        <filter id="stoneShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.8" floodColor="#000" floodOpacity="0.32" />
        </filter>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.24" numOctaves="3" seed="11" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      <rect x="0" y="0" width={VIEW} height={VIEW} rx="6" fill="url(#wood)" />
      <rect x="0" y="0" width={VIEW} height={VIEW} rx="6" filter="url(#grain)" opacity="0.07" />

      {/* 网格 */}
      <g stroke="var(--board-line)" strokeWidth={lineW} strokeLinecap="square">
        {Array.from({ length: size }, (_, i) => (
          <line key={`h${i}`} x1={PAD} y1={PAD + i * step} x2={VIEW - PAD} y2={PAD + i * step} />
        ))}
        {Array.from({ length: size }, (_, i) => (
          <line key={`v${i}`} x1={PAD + i * step} y1={PAD} x2={PAD + i * step} y2={VIEW - PAD} />
        ))}
      </g>

      {/* 星位 */}
      <g fill="var(--board-line)">
        {stars.map((v) => (
          <circle key={v} cx={px(v)} cy={py(v)} r={Math.max(2.6, step * 0.075)} />
        ))}
      </g>

      {/* 坐标 */}
      <g fill="var(--board-line)" opacity="0.68" fontSize={Math.min(26, step * 0.5)} fontFamily="var(--font-body)">
        {Array.from({ length: size }, (_, i) => (
          <text key={`cx${i}`} x={PAD + i * step} y={VIEW - PAD * 0.34} textAnchor="middle">
            {GTP_LETTERS[i]}
          </text>
        ))}
        {Array.from({ length: size }, (_, i) => (
          <text key={`cy${i}`} x={PAD * 0.44} y={PAD + i * step + step * 0.17} textAnchor="middle">
            {size - i}
          </text>
        ))}
      </g>

      {/* 形势图 */}
      {showOwnership && ownership && ownership.length === size * size && (
        <g opacity="0.34">
          {ownership.map((val, v) => {
            if (Math.abs(val) < 0.12) return null;
            return (
              <rect
                key={`o${v}`}
                x={px(v) - step * 0.42}
                y={py(v) - step * 0.42}
                width={step * 0.84}
                height={step * 0.84}
                rx={step * 0.18}
                fill={val > 0 ? 'var(--stone-black)' : 'var(--stone-white)'}
                opacity={Math.min(1, Math.abs(val))}
              />
            );
          })}
        </g>
      )}

      {/* 棋子 */}
      <g filter="url(#stoneShadow)">
        {grid.map((c, v) => {
          if (!c) return null;
          const isDead = deadSet.has(v);
          return (
            <g key={`s${v}`} opacity={isDead ? 0.34 : 1}>
              <circle
                cx={px(v)}
                cy={py(v)}
                r={stoneR}
                fill={c === 1 ? 'url(#stoneBlack)' : 'url(#stoneWhite)'}
                stroke={c === 1 ? 'rgba(0,0,0,.5)' : 'rgba(120,110,96,.45)'}
                strokeWidth="1"
              />
              {isDead && (
                <g stroke="var(--danger)" strokeWidth="4" opacity="0.9">
                  <line x1={px(v) - stoneR * 0.6} y1={py(v) - stoneR * 0.6} x2={px(v) + stoneR * 0.6} y2={py(v) + stoneR * 0.6} />
                  <line x1={px(v) + stoneR * 0.6} y1={py(v) - stoneR * 0.6} x2={px(v) - stoneR * 0.6} y2={py(v) + stoneR * 0.6} />
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* 最后一手 */}
      {typeof lastMove === 'number' && lastMove >= 0 && grid[lastMove] ? (
        <circle
          cx={px(lastMove)}
          cy={py(lastMove)}
          r={Math.max(3.2, stoneR * 0.22)}
          fill={grid[lastMove] === 1 ? 'var(--stone-white)' : 'var(--stone-black)'}
          opacity="0.9"
        />
      ) : null}

      {/* 幽灵子（变化预览） */}
      {[...ghostMap.entries()].map(([v, order]) => (
        <g key={`g${v}`} opacity="0.55">
          <circle
            cx={px(v)}
            cy={py(v)}
            r={stoneR}
            fill={hover !== null && grid[hover] === 0 ? 'transparent' : 'transparent'}
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeDasharray="6 5"
          />
          <text
            x={px(v)}
            y={py(v) + stoneR * 0.28}
            textAnchor="middle"
            fontSize={stoneR * 0.72}
            fill="var(--accent)"
            fontFamily="var(--font-body)"
          >
            {order + 1}
          </text>
        </g>
      ))}

      {/* 悬停预落子 */}
      {interactive && hover !== null && grid[hover] === 0 && (
        <g pointerEvents="none">
          {hoverMark === 'ghost' ? (
            <>
              <circle cx={px(hover)} cy={py(hover)} r={stoneR} fill="var(--primary)" opacity="0.3" />
              <circle
                cx={px(hover)}
                cy={py(hover)}
                r={stoneR}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray="7 6"
                opacity="0.95"
              />
            </>
          ) : (
            <>
              <rect
                x={px(hover) - stoneR * 0.72}
                y={py(hover) - stoneR * 0.72}
                width={stoneR * 1.44}
                height={stoneR * 1.44}
                rx={Math.max(2, stoneR * 0.14)}
                fill="var(--accent)"
                opacity="0.72"
              />
              <rect
                x={px(hover) - stoneR * 0.72}
                y={py(hover) - stoneR * 0.72}
                width={stoneR * 1.44}
                height={stoneR * 1.44}
                rx={Math.max(2, stoneR * 0.14)}
                fill="none"
                stroke="var(--board-line)"
                strokeWidth={2}
                opacity="0.45"
              />
            </>
          )}
        </g>
      )}

      {/* 点击区 */}
      <g>
        {Array.from({ length: size * size }, (_, v) => (
          <rect
            key={`hit${v}`}
            x={px(v) - step / 2}
            y={py(v) - step / 2}
            width={step}
            height={step}
            fill="transparent"
            style={{ cursor: interactive || (onToggleDead && grid[v]) ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(v)}
            onMouseLeave={() => setHover((h) => (h === v ? null : h))}
            onClick={() => {
              if (onToggleDead && grid[v]) {
                onToggleDead(v);
                return;
              }
              // 有子的点也交出去：摆棋要能擦/改色，对局则由服务端回「该点已有棋子」，
              // 合法性与提示文案只留规则层一处（AGENTS.md §6 I4）。
              if (interactive) onPlace?.(v);
            }}
          />
        ))}
      </g>
    </svg>
    </div>
  );
}
