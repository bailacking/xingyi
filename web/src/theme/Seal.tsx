import { useId } from 'react';

/**
 * 印章字体：楷体优先（仿古），系统没有就退回宋体。
 * Windows 的注册名是 KaiTi，macOS 是 Kaiti SC / STKaiti —— **KaiTi 必须排第一**，
 * 否则 Windows 上会先命中后面的宋体（上一版就是这么翻车的，字看着像宋体）。
 */
const KAI =
  'KaiTi, "Kaiti SC", STKaiti, "楷体", "AR PL UKai CN", "Source Han Serif SC", "Songti SC", STSong, serif';

export interface SealProps {
  /** 印面文字，2 字最常见（如「陆级」）；1~4 字自动排布，超过 4 字只刻前 4 个 */
  text: string;
  /** true = 白文（朱底白字，轮到你）；false = 朱文（红框红字，等着） */
  active?: boolean;
  /** 边长（px）；印章永远是 1:1 正方形 */
  size?: number;
}

interface Glyph {
  c: string;
  x: number;
  y: number;
  s: number;
}

/** 印面排版：一列 / 两列（右起），字号随字数收 */
function layout(chars: string[]): Glyph[] {
  const n = Math.min(chars.length, 4);
  if (n <= 1) return [{ c: chars[0] ?? '', x: 50, y: 50, s: 56 }];
  if (n === 2) {
    return [
      { c: chars[0]!, x: 50, y: 37, s: 33 },
      { c: chars[1]!, x: 50, y: 67, s: 33 },
    ];
  }
  if (n === 3) {
    // 右列两字、左列一字（传统印面读法：右起竖读）
    return [
      { c: chars[0]!, x: 64, y: 34, s: 26 },
      { c: chars[1]!, x: 64, y: 66, s: 26 },
      { c: chars[2]!, x: 36, y: 50, s: 26 },
    ];
  }
  return [
    { c: chars[0]!, x: 64, y: 34, s: 26 },
    { c: chars[1]!, x: 64, y: 66, s: 26 },
    { c: chars[2]!, x: 36, y: 34, s: 26 },
    { c: chars[3]!, x: 36, y: 66, s: 26 },
  ];
}

/**
 * 仿古方印：1:1、楷体、双边框、边框带一点抖动（不是 CSS 画的死方框）。
 * 颜色全走 --seal / --seal-text，四套主题自动跟着变。
 */
export function Seal({ text, active = false, size = 46 }: SealProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glyphs = layout([...text]);
  const ink = 'var(--seal-text)';
  const red = 'var(--seal)';

  return (
    <svg
      className={`seal-mark${active ? ' is-active' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`印章：${text}`}
    >
      <defs>
        <filter id={`worn${uid}`} x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id={`grain${uid}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="5" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      {active && <rect x="2" y="2" width="96" height="96" fill={red} />}
      {active && <rect x="2" y="2" width="96" height="96" filter={`url(#grain${uid})`} opacity="0.09" />}

      <g fill="none" stroke={active ? ink : red} strokeLinejoin="round" filter={`url(#worn${uid})`}>
        <path d="M7 6.2 L93.4 5.4 L93.8 93.1 L6.4 94.2 Z" strokeWidth="4.6" opacity={active ? 0.62 : 1} />
        <path d="M16.2 15.6 L84.2 15 L83.8 84.4 L15.7 85 Z" strokeWidth="1.6" opacity={active ? 0.34 : 0.55} />
      </g>

      <g
        fontFamily={KAI}
        fontWeight={500}
        fill={active ? ink : red}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {glyphs.map((g, i) => (
          <text key={`${g.c}-${i}`} x={g.x} y={g.y} fontSize={g.s} letterSpacing="0.6">
            {g.c}
          </text>
        ))}
      </g>
    </svg>
  );
}
