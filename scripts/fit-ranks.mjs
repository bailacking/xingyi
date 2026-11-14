#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LEVEL_PARAMS } from '../packages/engine/dist/index.js';
import { defaultRankTable } from '../packages/rating/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = defaultRankTable();
const maxLevel = target.maxLevel;
const scale = 400 / Math.log(10);
const appHash = crypto.createHash('sha1').update(JSON.stringify(
  LEVEL_PARAMS.map((p) => [p.level, p.profile, p.maxVisits, p.lambda, p.rootExplore, null]),
)).digest('hex').slice(0, 12);

const trainingFiles = [];
const holdoutFiles = [];
let write = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--write') write = true;
  else if (arg === '--holdout' && process.argv[i + 1]) holdoutFiles.push(process.argv[++i]);
  else if (arg.startsWith('--')) throw new Error('未知选项 ' + arg);
  else trainingFiles.push(arg);
}
if (!trainingFiles.length) throw new Error('用法：node scripts/fit-ranks.mjs <日志...> [--holdout <日志>] [--write]');

const signature = (meta) => JSON.stringify([meta.version, meta.size, meta.komi, meta.ladderHash, meta.environment]);
const pairKey = (a, b) => a + '-' + b;

function readMatches(files, expectedSignature) {
  const matched = new Map();
  let dropped = 0;
  let meta;
  for (const file of files) {
    const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const head = rows.shift();
    if (head?.type !== 'meta') throw new Error('缺少日志头 ' + file);
    if (head.ladder?.length !== maxLevel) throw new Error('旧等级顺序的日志不能用于 25 级拟合：' + file);
    if (expectedSignature && expectedSignature !== signature(head)) throw new Error('日志的引擎、棋盘或阶梯配置不一致');
    meta ??= head;
    expectedSignature ??= signature(head);
    for (const row of rows) {
      const [a, b] = row.pair;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > maxLevel || a >= b ||
          !['B', 'W'].includes(row.loColor) || !['B', 'W'].includes(row.winner)) {
        dropped++;
        continue;
      }
      const opening = row.openingIndex ?? Math.floor((row.game - 1) / 2);
      const key = pairKey(a, b) + '/' + opening;
      const games = matched.get(key) ?? new Map();
      if (games.has(row.loColor)) throw new Error('发现重复开局/颜色 ' + key + ' ' + row.loColor);
      games.set(row.loColor, row);
      matched.set(key, games);
    }
  }
  const rows = [];
  const openings = new Set();
  for (const [key, games] of matched) {
    const pair = [...games.values()];
    if (pair.length !== 2 || pair.some((row) => row.capped || !row.adjudicated) ||
        JSON.stringify(pair[0].opening) !== JSON.stringify(pair[1].opening)) {
      dropped += pair.length;
      continue;
    }
    rows.push(...pair);
    openings.add(key);
  }
  return { meta, rows, openings, dropped };
}

function stats(rows) {
  const byPair = new Map();
  for (const row of rows) {
    const [a, b] = row.pair;
    const key = pairKey(a, b);
    const pair = byPair.get(key) ?? { a, b, wins: 0, games: 0 };
    pair.games++;
    pair.wins += Number(row.winner === row.loColor);
    byPair.set(key, pair);
  }
  return byPair;
}

function wilson(wins, games) {
  const z = 1.96;
  const p = wins / games;
  const d = 1 + z * z / games;
  const center = (p + z * z / (2 * games)) / d;
  const radius = z * Math.sqrt((p * (1 - p) + z * z / (4 * games)) / games) / d;
  return [center - radius, center + radius];
}

const pct = (value) => (100 * value).toFixed(0) + '%';
function report(label, data, byPair) {
  console.log(label + ' · ' + data.rows.length + ' 盘有效 · ' + data.dropped + ' 盘剔除');
  for (const { a, b, wins, games } of byPair.values()) {
    const [low, high] = wilson(wins, games);
    console.log('  ' + a + ' vs ' + b + ' · 强档胜 ' + wins + '/' + games +
      ' · Wilson 95% [' + pct(low) + ', ' + pct(high) + ']');
  }
}

// Bradley–Terry 二元胜负模型。评分先验只抑制小样本漂移，允许诊断相邻档倒挂。
function fit(rows) {
  const anchor = target.levels[Math.floor(maxLevel / 2)];
  const prior = target.levels.map(({ rating }) => (rating - anchor.rating) / scale);
  const strength = [...prior];
  const frequency = new Array(maxLevel).fill(0);
  for (const { pair: [a, b] } of rows) {
    frequency[a - 1]++;
    frequency[b - 1]++;
  }
  let black = 0;
  const rate = 1 / Math.max(1, rows.length / 4, Math.max(...frequency) / 2);
  for (let iteration = 0; iteration < 1500; iteration++) {
    const gradient = strength.map((value, i) => prior[i] - value);
    let colorGradient = -black;
    for (const row of rows) {
      const [a, b] = row.pair.map((level) => level - 1);
      const sign = row.loColor === 'B' ? 1 : -1;
      const p = 1 / (1 + Math.exp(strength[b] - strength[a] - sign * black));
      const residual = Number(row.winner === row.loColor) - p;
      gradient[a] += residual;
      gradient[b] -= residual;
      colorGradient += sign * residual;
    }
    black += rate * colorGradient;
    for (let i = 0; i < maxLevel; i++) if (i !== anchor.level - 1) strength[i] += rate * gradient[i];
    if (Math.max(Math.abs(colorGradient), ...gradient.map((g, i) => i === anchor.level - 1 ? 0 : Math.abs(g))) < 1e-5) break;
  }
  return { ratings: strength.map((value) => Math.round(anchor.rating + value * scale)), blackElo: Math.round(black * scale) };
}

const training = readMatches(trainingFiles);
const holdout = holdoutFiles.length ? readMatches(holdoutFiles, signature(training.meta)) : null;
const trainingStats = stats(training.rows);
report('拟合样本', training, trainingStats);
if (!training.rows.length) throw new Error('没有可用的换色对局');
const fitted = fit(training.rows);
console.log('拟合强度（未强制单调）', fitted.ratings.join(', '), '黑棋偏差', fitted.blackElo);
if (holdout) report('留出验证', holdout, stats(holdout.rows));

if (write) {
  const { meta } = training;
  if (meta.version !== 3 || meta.size !== 19 || meta.komi !== 7.5 || meta.ladderHash !== appHash || !meta.environment) {
    throw new Error('写入要求当前阶梯的 19 路分先日志和引擎指纹');
  }
  const trainingOpenings = new Set([...training.openings].map((key) => key.split('/')[1]));
  if (!holdout || [...holdout.openings].some((key) => trainingOpenings.has(key.split('/')[1]))) {
    throw new Error('写入要求开局独立的留出验证日志');
  }
  const validation = stats(holdout.rows);
  for (let k = 1; k < maxLevel; k++) {
    const key = pairKey(k, k + 1);
    const held = validation.get(key);
    if ((trainingStats.get(key)?.games ?? 0) < 60 || !held || held.games < 100 ||
        wilson(held.wins, held.games)[0] <= 0.5 || held.wins / held.games > 0.70 ||
        fitted.ratings[k - 1] <= fitted.ratings[k]) {
      throw new Error(key + ' 样本不足、强度倒挂、相邻间距过大或尚无法区分。请继续测量或调整参数。');
    }
  }
  const out = {
    ...target,
    calibrated: true,
    size: 19,
    note: '相对棋力通过换色自对弈及留出检验。一级的职业初段目标仍需真人验证。',
    ladderHash: appHash,
    environment: meta.environment,
    levels: target.levels.map((row, i) => ({
      ...row,
      rating: fitted.ratings[i],
      calibrated: true,
      sample: [...trainingStats.values()].reduce((sum, pair) => sum + (pair.a === row.level || pair.b === row.level ? pair.games : 0), 0),
    })),
  };
  const file = path.join(root, 'data/ranks.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  console.log('已更新 ' + file);
}
