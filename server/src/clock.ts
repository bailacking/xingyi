import type { Color, ClockView, TimeControl } from '@xingyi/shared';

/**
 * 计时：主时间 + 日式读秒。
 *
 * 规则（简化版，界面文案照这个写，别在别处另讲一套）：
 * - 主时间用完 → 进入读秒，每手给你 `byoYomiSec` 秒；
 * - 读秒期间每落一手就重置为满额；
 * - 一手超时消耗一期，`periods` 期用完判负；
 * - `periods = 0` 就是包干（主时间用完直接判负）。
 *
 * 时间只在**轮到谁**的时候走，所以 AI 思考也算自己的时间（KataGo 一般 <2 秒，不影响）。
 */
export const DEFAULT_TIME_CONTROL: TimeControl = { mainSec: 600, byoYomiSec: 30, periods: 3 };

export const TIME_PRESETS: { id: string; name: string; control: TimeControl | null }[] = [
  { id: 'none', name: '不限时', control: null },
  { id: '10m', name: '10 分 + 3×30 秒', control: { mainSec: 600, byoYomiSec: 30, periods: 3 } },
  { id: '5m', name: '5 分 + 3×30 秒', control: { mainSec: 300, byoYomiSec: 30, periods: 3 } },
  { id: 'blitz', name: '3 分包干', control: { mainSec: 180, byoYomiSec: 0, periods: 0 } },
];

export class Clock {
  readonly control: TimeControl;
  /** 当前段剩余毫秒 */
  private ms: Record<Color, number>;
  private periodsLeft: Record<Color, number>;
  private inByo: Record<Color, boolean> = { B: false, W: false };
  running: Color | null = null;
  private last = Date.now();

  constructor(control: TimeControl) {
    this.control = {
      mainSec: Math.max(0, Math.round(control.mainSec)),
      byoYomiSec: Math.max(0, Math.round(control.byoYomiSec)),
      periods: Math.max(0, Math.round(control.periods)),
    };
    const main = this.control.mainSec * 1000;
    this.ms = { B: main, W: main };
    this.periodsLeft = { B: this.control.periods, W: this.control.periods };
  }

  start(color: Color, now = Date.now()): void {
    this.running = color;
    this.last = now;
  }

  /** 换手：先把上一手的时间扣掉，再给新的一方满额读秒 */
  switchTo(color: Color, now = Date.now()): Color | null {
    const flagged = this.tick(now);
    if (flagged) return flagged;
    // 同一方重复调用（比如每秒推一次快照）不能重置读秒，否则永远读不完
    if (this.running === color) {
      this.last = now;
      return null;
    }
    if (this.inByo[color] && this.control.byoYomiSec > 0) this.ms[color] = this.control.byoYomiSec * 1000;
    this.running = color;
    this.last = now;
    return null;
  }

  pause(now = Date.now()): void {
    this.tick(now);
    this.running = null;
    this.last = now;
  }

  /** 推进时间；返回超时判负的一方（没有超时返回 null） */
  tick(now = Date.now()): Color | null {
    const c = this.running;
    if (!c) {
      this.last = now;
      return null;
    }
    const dt = Math.max(0, now - this.last);
    this.last = now;
    if (dt === 0) return null;

    this.ms[c] -= dt;
    if (this.ms[c] > 0) return null;

    if (!this.inByo[c]) {
      if (this.control.periods <= 0 || this.control.byoYomiSec <= 0) {
        this.ms[c] = 0;
        this.running = null;
        return c;
      }
      // 主时间用完，进入读秒；超出的部分从第一期里扣
      this.inByo[c] = true;
      this.ms[c] += this.control.byoYomiSec * 1000;
      if (this.ms[c] > 0) return null;
    }
    return this.consumePeriods(c, -this.ms[c]);
  }

  /** 一期不够扣就继续扣，扣完判负 */
  private consumePeriods(c: Color, overflow: number): Color | null {
    let left = overflow;
    while (this.periodsLeft[c] > 0) {
      this.periodsLeft[c] -= 1;
      const span = this.control.byoYomiSec * 1000;
      if (left < span) {
        this.ms[c] = span - left;
        return null;
      }
      left -= span;
    }
    this.ms[c] = 0;
    this.running = null;
    return c;
  }

  view(): ClockView {
    return {
      blackMs: Math.max(0, Math.round(this.ms.B)),
      whiteMs: Math.max(0, Math.round(this.ms.W)),
      periods: { ...this.periodsLeft },
      running: this.running,
      inByoYomi: { ...this.inByo },
      control: { ...this.control },
    };
  }
}
