import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RATING_PARAMS,
  applyJumpExam,
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

describe('定级赛（最多五盘）', () => {
  it('首局 13 级，赢了挑战更强的 7 级，输了改打 19 级', () => {
    const win = createProgress();
    const loss = createProgress();
    expect(win.placement.current).toBe(13);
    expect(recordPlacementResult(win, ranks, true)?.level).toBe(7);
    expect(recordPlacementResult(loss, ranks, false)?.level).toBe(19);
  });

  it('无噪声时在五盘内能定位任意一级，包括全胜和全负', () => {
    for (let level = 1; level <= 25; level++) {
      const p = createProgress();
      for (let i = 0; i < 5 && !p.placement.done; i++) {
        recordPlacementResult(p, ranks, p.placement.current >= level);
      }
      expect(p.placement.done).toBe(true);
      expect(p.level).toBe(level);
      expect(p.R).toBe(ratingOf(ranks, level));
      expect(p.provisional).toBe(true);
    }
  });
});

describe('升降级判定', () => {
  it('分够 + 本级满 3 盘 + 连胜 2 → 升级', () => {
    const p = createProgress();
    p.level = 5;
    p.levelGames = 3;
    p.levelWins = 2;
    p.streak = 2;
    // 默认表步长 75 → 升级线 = A4 − max(20, 0.35×75) ≈ A4 − 26
    p.R = ratingOf(ranks, 4) - 20;
    const v = evaluateLevel(p, ranks);
    expect(v.promote).toBe(true);
  });

  it('升级线随局部步长缩放（宽档位不会一局就升）', () => {
    const wide = normalizeRankTable({
      ladderVersion: 2,
      maxLevel: 25,
      levels: Array.from({ length: 25 }, (_, i) => ({ level: i + 1, rating: 1525 + (12 - i) * 200 })),
    });
    const p = createProgress();
    p.level = 5;
    p.levelGames = 3;
    p.levelWins = 2;
    p.streak = 2;
    // 步长 200 → 阈值 70：差 80 分不该升，差 30 分该升
    p.R = ratingOf(wide, 4) - 80;
    expect(evaluateLevel(p, wide).promote).toBe(false);
    p.R = ratingOf(wide, 4) - 30;
    expect(evaluateLevel(p, wide).promote).toBe(true);
  });

  it('本级不足 3 盘不升', () => {
    const p = createProgress();
    p.level = 5;
    p.levelGames = 2;
    p.levelWins = 2;
    p.streak = 2;
    p.R = ratingOf(ranks, 4);
    expect(evaluateLevel(p, ranks).promote).toBe(false);
  });

  it('保级期挡住降级', () => {
    const p = createProgress();
    p.level = 5;
    p.streak = -3;
    p.R = ratingOf(ranks, 6) - 200;
    p.protection = 2;
    expect(evaluateLevel(p, ranks).demote).toBe(false);
    p.protection = 0;
    expect(evaluateLevel(p, ranks).demote).toBe(true);
  });

  it('退级缓冲期内不连降', () => {
    const p = createProgress();
    p.level = 5;
    p.streak = -3;
    p.R = ratingOf(ranks, 6) - 200;
    p.demotionBuffer = 4;
    expect(evaluateLevel(p, ranks).demote).toBe(false);
  });

  it('满级不再升，也不出现「可进一级」', () => {
    const p = createProgress();
    p.level = 1;
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
    p.R = ratingOf(ranks, 4) - 20;
    expect(evaluateLevel(p, ranks).pending).toBe(true);
  });
});

describe('等级表规范化', () => {
  it('未测或外推级仍使整张表保持暂定', () => {
    const raw = {
      ...ranks,
      levels: ranks.levels.map((row, i) => ({ ...row, calibrated: i !== 13, extrapolated: i === 13 })),
    };
    expect(normalizeRankTable(raw).calibrated).toBe(false);
    expect(normalizeRankTable(raw).levels[13]?.extrapolated).toBe(true);
  });

  it('旧表与倒挂表回退到 25 级暂定曲线', () => {
    const legacy = { maxLevel: 15, levels: Array.from({ length: 15 }, (_, i) => ({ level: i + 1, rating: 900 + i * 90 })) };
    expect(normalizeRankTable(legacy)).toEqual(ranks);
    const reversed = { ...ranks, levels: ranks.levels.map((row) => ({ ...row, rating: -row.rating })) };
    expect(normalizeRankTable(reversed)).toEqual(ranks);
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
    p.R = ratingOf(ranks, 4) - 45;
    const out = applyRankedGame(p, { won: true, scoreDiff: 12, moves: 150, ranks });
    expect(out.change).toBe('up');
    expect(p.level).toBe(4);
    expect(p.protection).toBe(3);
    expect(p.levelGames).toBe(0);
  });

  it('考核赢跳两级并写入最终级，输时留在原级', () => {
    const input = { scoreDiff: 4, moves: 160 };
    const p = createProgress();
    p.placement.done = true;
    p.level = 5;
    p.R = ratingOf(ranks, 5) - 300;
    p.streak = -4;
    applyJumpExam(p, ranks, 3, false, input);
    expect(p.level).toBe(5);
    expect(p.promotionCooldown).toBe(3);
    applyJumpExam(p, ranks, 3, true, input);
    expect(p.level).toBe(3);
    expect(p.history.at(-1)?.levelAfter).toBe(3);
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
  it('旧版已定级存档按对手参数迁移，保留历史与原编号，再加载不会重算', () => {
    const old = createProgress('旧棋友', 15);
    old.schemaVersion = 1;
    old.placement.done = true;
    old.placement.results = [{ level: 8, won: true }];
    old.level = 8;
    old.R = 1540;
    old.gamesTotal = 17;
    old.history = [{ at: '2026-10-19', mode: 'ranked', level: 8, won: true, scoreDiff: 1, moves: 120, deltaR: 12, levelAfter: 9 }];
    const migrated = normalizeProgress(old);
    expect(migrated.level).toBe(11);
    expect(migrated.R).toBe(ratingOf(ranks, 11) + 15);
    expect(migrated.gamesTotal).toBe(17);
    expect(migrated.history[0]).toMatchObject({ level: 11, levelAfter: 9, legacyLevels: { opponent: 8, after: 9 } });
    expect(migrated.legacyPlacement?.results).toEqual(old.placement.results);
    expect(normalizeProgress(migrated)).toEqual(migrated);
  });

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
    expect(p.level).toBe(13);
    expect(p.RD).toBe(RATING_PARAMS.initialRD);
    expect(p.placement.done).toBe(false);
    expect(Array.isArray(p.history)).toBe(true);
  });
});
