/**
 * 音效：全部用 WebAudio 现场合成，不引入任何素材文件 ——
 * 零版权风险（AGENTS.md H1 零版权风险），以后替换为 CC0 录音只需换这一层。
 *
 * 三种音色 + 音量可调：玉石（脆）/ 青瓷（亮而短）/ 木石（温厚）。
 * 只有三类声音：落子、提子、终局一声磬（D30，不做读秒声）。
 */

export type SoundPack = 'jade' | 'porcelain' | 'wood';

export interface SoundConfig {
  enabled: boolean;
  pack: SoundPack;
  /** 0..1 */
  volume: number;
}

export const SOUND_PACKS: { id: SoundPack; name: string; hint: string }[] = [
  { id: 'jade', name: '玉石', hint: '清脆，像玉石敲在木盘上' },
  { id: 'porcelain', name: '青瓷', hint: '最亮最短，干脆利落' },
  { id: 'wood', name: '木石', hint: '温厚低沉，不刺耳' },
];

const conf: SoundConfig = { enabled: true, pack: 'jade', volume: 0.75 };
let ctx: AudioContext | null = null;

export function configureSound(patch: Partial<SoundConfig>): void {
  if (typeof patch.enabled === 'boolean') conf.enabled = patch.enabled;
  if (patch.pack) conf.pack = patch.pack;
  if (typeof patch.volume === 'number') conf.volume = Math.max(0, Math.min(1, patch.volume));
}

export function getSoundConfig(): SoundConfig {
  return { ...conf };
}

function ensure(): AudioContext | null {
  if (!conf.enabled || conf.volume <= 0.001) return null;
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 每种音色的"材质"参数：噪声指弹（撞击瞬态）+ 几个谐振峰（盘体共鸣） */
const TIMBRE: Record<
  SoundPack,
  { hp: number; q: number; noiseDur: number; body: [number, number][]; scale: number }
> = {
  jade: { hp: 4200, q: 0.85, noiseDur: 0.022, body: [[1860, 0.055], [3720, 0.02]], scale: 1 },
  porcelain: { hp: 6200, q: 1.0, noiseDur: 0.015, body: [[2580, 0.038], [5160, 0.014]], scale: 0.95 },
  wood: { hp: 1500, q: 0.7, noiseDur: 0.032, body: [[330, 0.11], [660, 0.04]], scale: 1.05 },
};

function noiseBurst(ac: AudioContext, out: AudioNode, dur: number, hp: number, q: number, peak: number): void {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // 指数衰减的白噪：起手几毫秒最响，之后迅速收掉（撞击的"啪"）
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filt = ac.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = hp;
  filt.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(peak, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0005, ac.currentTime + dur * 1.4);
  src.connect(filt).connect(g).connect(out);
  src.start();
  src.stop(ac.currentTime + dur * 1.6);
}

function tone(ac: AudioContext, out: AudioNode, freq: number, dur: number, peak: number): void {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(peak, ac.currentTime + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(g).connect(out);
  osc.start();
  osc.stop(ac.currentTime + dur + 0.02);
}

function master(ac: AudioContext): GainNode {
  const m = ac.createGain();
  m.gain.value = conf.volume;
  m.connect(ac.destination);
  return m;
}

/** 落子 / 提子。captured=true 时音高略抬、稍响，听感上"提掉了一片"。 */
export function playStone(captured = false): void {
  const ac = ensure();
  if (!ac) return;
  const t = TIMBRE[conf.pack];
  const out = master(ac);
  const shift = captured ? 1.14 : 1;
  noiseBurst(ac, out, t.noiseDur, t.hp * (captured ? 1.2 : 1), t.q, 0.16 * t.scale);
  const per = 0.055 * t.scale * (captured ? 1.2 : 1);
  for (const [freq, dur] of t.body) {
    tone(ac, out, freq * shift, dur, per / t.body.length + 0.012);
  }
  if (captured) {
    // 提子多一下极轻的二次撞击，像棋子叠落
    window.setTimeout(() => {
      const ac2 = ensure();
      if (!ac2) return;
      noiseBurst(ac2, master(ac2), 0.014, t.hp * 1.1, t.q, 0.07 * t.scale);
    }, 45);
  }
}

/** 终局一声磬：三个泛音，衰减 1.8 秒 */
export function playBell(): void {
  const ac = ensure();
  if (!ac) return;
  const out = master(ac);
  for (const [freq, gain] of [
    [523.25, 0.07],
    [784, 0.04],
    [1046.5, 0.022],
  ] as const) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ac.createGain();
    const now = ac.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc.connect(g).connect(out);
    osc.start(now);
    osc.stop(now + 1.9);
  }
}

/** 试听：落子 + 提子各一下（设置页用；临时绕过"音效开关"，方便挑音色） */
export function previewPack(pack: SoundPack): void {
  const prev = { ...conf };
  conf.enabled = true;
  conf.pack = pack;
  if (conf.volume <= 0.001) conf.volume = 0.75;
  playStone(false);
  window.setTimeout(() => playStone(true), 260);
  window.setTimeout(() => {
    conf.enabled = prev.enabled;
    conf.pack = prev.pack;
    conf.volume = prev.volume;
  }, 700);
}
