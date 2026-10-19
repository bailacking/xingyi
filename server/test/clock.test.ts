import { describe, expect, it } from 'vitest';
import { Clock, DEFAULT_TIME_CONTROL, TIME_PRESETS } from '../src/clock.js';
import { handicapKomi, handicapStones } from '../src/handicap.js';

describe('计时（主时间 + 读秒）', () => {
  it('默认 10 分 + 3×30 秒；预设里有一个「不限时」', () => {
    expect(DEFAULT_TIME_CONTROL).toEqual({ mainSec: 600, byoYomiSec: 30, periods: 3 });
    expect(TIME_PRESETS.find((p) => p.id === 'none')?.control).toBeNull();
  });

  it('主时间内正常走表', () => {
    const c = new Clock({ mainSec: 60, byoYomiSec: 30, periods: 3 });
    c.start('B', 1000);
    expect(c.tick(11000)).toBeNull();
    const v = c.view();
    expect(v.blackMs).toBe(50000);
    expect(v.inByoYomi.B).toBe(false);
    expect(v.running).toBe('B');
  });

  it('主时间用完进入读秒，读秒期间每手重置', () => {
    const c = new Clock({ mainSec: 3, byoYomiSec: 10, periods: 2 });
    c.start('B', 0);
    expect(c.tick(3500)).toBeNull(); // 主时间超了 0.5 秒，从第一期里扣
    let v = c.view();
    expect(v.inByoYomi.B).toBe(true);
    expect(v.periods.B).toBe(2);
    expect(v.blackMs).toBe(9500);

    // 白走一手再回黑：黑按满额读秒重置
    expect(c.switchTo('W', 4000)).toBeNull();
    expect(c.switchTo('B', 4500)).toBeNull();
    v = c.view();
    expect(v.blackMs).toBe(10000);
  });

  it('读秒超期一期一期扣，扣完判负', () => {
    const c = new Clock({ mainSec: 0, byoYomiSec: 10, periods: 2 });
    c.start('W', 0);
    expect(c.tick(11000)).toBeNull(); // 超 1 秒 → 还剩 1 期
    let v = c.view();
    expect(v.periods.W).toBe(1);
    expect(v.whiteMs).toBe(9000);

    expect(c.tick(20000)).toBeNull(); // 第二期也用掉 → 读秒期为 0，但手上还有满额时间
    v = c.view();
    expect(v.periods.W).toBe(0);
    expect(v.whiteMs).toBe(10000);

    expect(c.tick(31000)).toBe('W'); // 时间再次到 0 且没有读秒了 → 白超时
    expect(c.view().running).toBeNull();
    expect(c.view().whiteMs).toBe(0);
  });

  it('包干（periods=0）：主时间用完直接判负', () => {
    const c = new Clock({ mainSec: 2, byoYomiSec: 0, periods: 0 });
    c.start('B', 0);
    expect(c.tick(1900)).toBeNull();
    expect(c.tick(2100)).toBe('B');
  });

  it('同一方重复 switchTo（每秒推快照）不会把读秒刷满', () => {
    const c = new Clock({ mainSec: 0, byoYomiSec: 10, periods: 3 });
    c.start('B', 0);
    expect(c.tick(3000)).toBeNull();
    const before = c.view().blackMs;
    expect(c.switchTo('B', 3000)).toBeNull();
    expect(c.view().blackMs).toBe(before);
  });

  it('暂停后不再走表', () => {
    const c = new Clock({ mainSec: 60, byoYomiSec: 30, periods: 3 });
    c.start('B', 0);
    c.pause(10000);
    const left = c.view().blackMs;
    expect(left).toBe(50000);
    expect(c.view().running).toBeNull();
    c.tick(60000);
    expect(c.view().blackMs).toBe(left);
  });
});

describe('让子摆位', () => {
  it('19 路 2 子在对角星位，4 子在四个角，9 子加四个边中与天元', () => {
    const p = (size: number, v: number): [number, number] => [v % size, Math.floor(v / size)];
    const two = handicapStones(19, 2).map((v) => p(19, v));
    expect(two).toEqual([
      [15, 3],
      [3, 15],
    ]);
    const four = handicapStones(19, 4);
    expect(new Set(four).size).toBe(4);
    expect(four).toContain(3 * 19 + 3);
    expect(four).toContain(15 * 19 + 15);
    for (const v of four) {
      const [x, y] = p(19, v);
      expect([3, 15]).toContain(x);
      expect([3, 15]).toContain(y);
    }
    const nine = handicapStones(19, 9);
    expect(new Set(nine).size).toBe(9);
    expect(nine).toContain(9 * 19 + 9); // 天元
    expect(nine).toContain(3 * 19 + 9); // 左边中
  });

  it('9 路星位是 2/6，天元是 4', () => {
    const five = handicapStones(9, 5);
    expect(new Set(five).size).toBe(5);
    expect(five).toContain(4 * 9 + 4);
    expect(five).toContain(2 * 9 + 2);
    expect(five).toContain(6 * 9 + 6);
  });

  it('1 子/0 子不摆；2 子以上贴 0.5 目', () => {
    expect(handicapStones(19, 1)).toEqual([]);
    expect(handicapStones(19, 0)).toEqual([]);
    expect(handicapKomi(0, 7.5)).toBe(7.5);
    expect(handicapKomi(2, 7.5)).toBe(0.5);
  });
});
