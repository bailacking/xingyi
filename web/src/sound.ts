/**
 * 音效：全部用 WebAudio 现场合成，不引入任何素材文件 ——
 * 零版权风险（PLAN 的两条硬约束之一），以后替换为 CC0 录音只需换这一层。
 * 只有三种声音：落子、提子、终局一声磬（D30，不做读秒声）。
 */

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean): void {
  enabled = v;
}

function ensure(): AudioContext | null {
  if (!enabled) return null;
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  return buf;
}

/** 落子：一小段带通噪声 + 木质共鸣，短、干、不刺耳 */
export function playStone(captured = false): void {
  const ac = ensure();
  if (!ac) return;
  const now = ac.currentTime;

  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 0.05);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = captured ? 3200 : 2100;
  bp.Q.value = 1.1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.16, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(now);

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(captured ? 420 : 260, now);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.07, now);
  og.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
  osc.connect(og).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.13);
}

/** 终局一声磬：两个五度泛音，衰减长一些 */
export function playBell(): void {
  const ac = ensure();
  if (!ac) return;
  const now = ac.currentTime;
  for (const [freq, gain] of [
    [523.25, 0.10],
    [784, 0.055],
    [1046.5, 0.03],
  ] as const) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc.connect(g).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 1.9);
  }
}
