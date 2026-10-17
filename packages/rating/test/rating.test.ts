import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RATING_PARAMS,
  applyRankedGame,
  createProgress,
  defaultRankTable,
  evaluateLevel,
  expectedScore,
  kFactor,
  loadProgressFile,
  normalizeProgress,
  normalizeRankTable,
  ratingOf,
  recordPlacementResult,
  saveProgressFile,
  updateRating,
} from '../src/index.js';

const ranks = defaultRankTable();

describe('评分数学', () => {
  it('同分期望胜率 50%，高 75 分约 60.6%', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 6);
    expect(expectedScore(1575, 1500)).toBeCloseTo(0.606, 2);
    expect(expectedScore(1500, 1575)).toBeCloseTo(0.394, 2);
  });

  it('K 随 RD 单调下降', () => {
    expect(kFactor(350)).toBeGreaterThan(kFactor(150));
    expect(kFactor(150)).toBeGreaterThan(kFactor(RATING_PARAMS.minRD));
  });

  it('新号赢一盘涨分明显，输一盘跌分对称', () => {
    const base = {
      R: 1500,
      RD: 350,
      opponentRating: 1500,
      scoreDiff: 4,
      gamesAtLevel: 0,
      moves: 200,
      provisional: false,
    };
    const win = updateRating({ ...base, won: true });
    const lose = updateRating({ ...base, won: false });
    expect(win.deltaR).toBeGreaterThan(20);
    expect(win.deltaR).toBeCloseTo(-lose.deltaR, 5);
    expect(win.RD).toBeLessThan(350);
    expect(win.RD).toBeGreaterThanOrEqual(RATING_PARAMS.minRD);
  });

  it('暂定级 K 翻倍', () => {
    const args = {
      R: 1500,
      RD: 220,
      opponentRating: 1500,
      won: true,
      scoreDiff: 4,
      gamesAtLevel: 2,
      moves: 200,
    } as const;
    const normal = updateRating({ ...args, provisional: false });
    const prov = updateRating({ ...args, provisional: true });
    expect(prov.deltaR).toBeCloseTo(normal.deltaR * 2, 0);
    expect(prov.flags).toContain('provisional');
  });

  it('大胜比微胜幅度大（±20% 上限）', () => {
    const args = {
      R: 1500,
      RD: 220,
      opponentRating: 1500,
      won: true,
      gamesAtLevel: 2,
      moves: 200,
      provisional: false,
    } as const;
    const close = updateRating({ ...args, scoreDiff: 1 });
    const blowout = updateRating({ ...args, scoreDiff: 30 });
    expect(blowout.deltaR).toBeGreaterThan(close.deltaR);
    expect(blowout.deltaR / close.deltaR).toBeCloseTo(1.2 / 0.8, 1);
  });

  it('速胜（<40 手）只算半分', () => {
    const win = updateRating({
      R: 1500,
      RD: 220,
      opponentRating: 1500,
      won: true,
      scoreDiff: 10,
      gamesAtLevel: 2,
      moves: 25,
      provisional: false,
    });
    expect(win.s).toBe(0.5);
    expect(win.flags).toContain('speed-win');
  });

  it('同级超过 8 盘后 K 打折', () => {
    const args = {
      R: 1500,
      RD: 150,
      opponentRating: 1500,
      won: true,
      scoreDiff: 5,
      moves: 200,
      provisional: false,
    } as const;
    const normal = updateRating({ ...args, gamesAtLevel: 3 });
    const grindy = updateRating({ ...args, gamesAtLevel: 9 });
    expect(grindy.deltaR).toBeCloseTo(normal.deltaR / 2, 5);
    expect(grindy.flags).toContain('repeat');
  });
});

describe('定级赛（3 盘自适应二分）', () => {
  it('首局 8 级；赢了升到 12 级', () => {
    const p = createProgress();
    expect(p.placement.current).toBe(8);
    const r = recordPlacementResult(p, ranks, true);
    expect(r?.done).toBe(false);
    expect(p.placement.current).toBe(12);
  });

  it('首局 8 级；输了降到 4 级', () => {
    const p = createProgress();
    recordPlacementResult(p, ranks, false);
    expect(p.placement.current).toBe(4);
  });

  it('三盘后定级取"赢过的最高级"', () => {
    const p = createProgress();
    recordPlacementResult(p, ranks, true); // 8 赢 → 12
    recordPlacementResult(p, ranks, false); // 12 输 → 10
    const done = recordPlacementResult(p, ranks, true); // 10 赢
    expect(done?.done).toBe(true);
    expect(p.placement.done).toBe(true);
    expect(p.level).toBe(10);
    expect(p.R).toBe(ratingOf(ranks, 10));
    expect(p.provisional).toBe(true);
  });

  it('三盘全负 → 1 级', () => {
    const p = createProgress();
    recordPlacementResult(p, ranks, false);
    recordPlacementResult(p, ranks, false);
    const done = recordPlacementResult(p, ranks, false);
    expect(done?.done).toBe(true);
    expect(p.level).toBe(1);
  });
});

describe('升降级判定', () => {
  it('分够 + 本级满 3 盘 + 连胜 2 → 升级', () => {
    const p = createProgress();
    p.level = 5;
    p.levelGames = 3;
    p.levelWins = 2;
    p.streak = 2;
    // 默认表步长 75 → 升级线 = A6 − max(20, 0.35×75) ≈ A6 − 26
    p.R = ratingOf(ranks, 6) - 20;
    const v = evaluateLevel(p, ranks);
    expect(v.promote).toBe(true);
  });

  it('升级线随局部步长缩放（宽档位不会一局就升）', () => {
    const wide = normalizeRankTable({
      maxLevel: 15,
      levels: Array.from({ length: 15 }, (_, i) => ({ level: i + 1, rating: 1525 + (i + 1 - 8) * 200 })),
    });
    const p = createProgress();
    p.level = 5;
    p.levelGames = 3;
    p.levelWins = 2;
    p.streak = 2;
    // 步长 200 → 阈值 70：差 80 分不该升，差 30 分该升
    p.R = ratingOf(wide, 6) - 80;
    expect(evaluateLevel(p, wide).promote).toBe(false);
    p.R = ratingOf(wide, 6) - 30;
    expect(evaluateLevel(p, wide).promote).toBe(true);
  });

  it('本级不足 3 盘不升', () => {
    const p = createProgress();
    p.level = 5;
    p.levelGames = 2;
    p.levelWins = 2;
    p.streak = 2;
    p.R = ratingOf(ranks, 6);
    expect(evaluateLevel(p, ranks).promote).toBe(false);
  });

  it('保级期挡住降级', () => {
    const p = createProgress();
    p.level = 5;
    p.streak = -3;
    p.R = ratingOf(ranks, 4) - 200;
    p.protection = 2;
    expect(evaluateLevel(p, ranks).demote).toBe(false);
    p.protection = 0;
    expect(evaluateLevel(p, ranks).demote).toBe(true);
  });

  it('退级缓冲期内不连降', () => {
    const p = createProgress();
    p.level = 5;
    p.streak = -3;
    p.R = ratingOf(ranks, 4) - 200;
    p.demotionBuffer = 4;
    expect(evaluateLevel(p, ranks).demote).toBe(false);
  });

  it('满级不再升，也不出现「可进一级」', () => {
    const p = createProgress();
    p.level = ranks.maxLevel;
    p.levelGames = 5;
    p.levelWins = 5;
    p.streak = 5;
    p.R = 9999;
    const v = evaluateLevel(p, ranks);
    expect(v.promote).toBe(false);
    expect(v.pending).toBe(false);
  });

  it('连胜 3 且分够 → 出现「可进一级」', () => {
    const p = createProgress();
    p.level = 5;
    p.levelGames = 3;
    p.levelWins = 3;
    p.streak = 3;
    p.R = ratingOf(ranks, 6) - 20;
    expect(evaluateLevel(p, ranks).pending).toBe(true);
  });
});

describe('等级表规范化', () => {
  it('外推级不算"未实测"：全部已校准或外推时表级 calibrated 为真', () => {
    const raw = {
      maxLevel: 15,
      levels: Array.from({ length: 15 }, (_, i) => ({
        level: i + 1,
        rating: 1525 + (i + 1 - 8) * 100,
        calibrated: i < 12,
        extrapolated: i >= 12,
        sample: i < 12 ? 40 : 0,
      })),
    };
    const t = normalizeRankTable(raw);
    expect(t.calibrated).toBe(true);
    expect(t.levels[13]?.extrapolated).toBe(true);
    expect(t.levels[13]?.calibrated).toBe(false);
  });

  it('全是外推、没有任何实测 → 表级 calibrated 仍为假', () => {
    const raw = {
      maxLevel: 15,
      levels: Array.from({ length: 15 }, (_, i) => ({ level: i + 1, rating: 1525, extrapolated: true })),
    };
    expect(normalizeRankTable(raw).calibrated).toBe(false);
  });
});

describe('整局应用', () => {
  it('赢一盘：R 上升、本级计数 +1、写历史', () => {
    const p = createProgress();
    p.placement.done = true;
    p.level = 5;
    const out = applyRankedGame(p, { won: true, scoreDiff: 6, moves: 180, ranks });
    expect(p.R).toBeGreaterThan(RATING_PARAMS.initialR);
    expect(p.levelGames).toBe(1);
    expect(p.levelWins).toBe(1);
    expect(p.streak).toBeGreaterThan(0);
    expect(out.rating.deltaR).toBeGreaterThan(0);
    expect(p.history.length).toBe(1);
  });

  it('满足升级条件时自动升 1 级并进入保级期', () => {
    const p = createProgress();
    p.placement.done = true;
    p.level = 5;
    p.levelGames = 3;
    p.levelWins = 3;
    p.streak = 3;
    p.R = ratingOf(ranks, 6) - 45;
    const out = applyRankedGame(p, { won: true, scoreDiff: 12, moves: 150, ranks });
    expect(out.change).toBe('up');
    expect(p.level).toBe(6);
    expect(p.protection).toBe(3);
    expect(p.levelGames).toBe(0);
  });

  it('暂定级 10 盘后转正', () => {
    const p = createProgress();
    p.placement.done = true;
    p.gamesTotal = 9;
    p.provisional = true;
    applyRankedGame(p, { won: true, scoreDiff: 3, moves: 160, ranks });
    expect(p.gamesTotal).toBe(10);
    expect(p.provisional).toBe(false);
  });
});

describe('存档', () => {
  it('主档损坏时从 .bak 恢复', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyi-'));
    const file = path.join(dir, 'progress.json');
    const backupDir = path.join(dir, 'backups');
    const p = createProgress('大帅');
    saveProgressFile(file, backupDir, p);
    p.playerName = '大帅2';
    saveProgressFile(file, backupDir, p); // 生成 .bak（内容是第一版）
    fs.writeFileSync(file, '{ 坏档', 'utf8');
    const loaded = loadProgressFile(file);
    expect(loaded?.playerName).toBe('大帅');
    const now = new Date();
    const localKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    expect(fs.existsSync(path.join(backupDir, `progress-${localKey}.json`))).toBe(true);
  });

  it('旧存档缺字段也能读（normalize 补齐）', () => {
    const p = normalizeProgress({ level: 7, R: 1600 });
    expect(p.level).toBe(7);
    expect(p.RD).toBe(RATING_PARAMS.initialRD);
    expect(p.placement.done).toBe(false);
    expect(Array.isArray(p.history)).toBe(true);
  });
});
