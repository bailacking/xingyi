#!/usr/bin/env node
/**
 * 15 级校准：让相邻两级互下 N 盘，量出每一级的评分 A_k。
 *
 * 用法（先关掉星弈服务，避免两个引擎抢显存）：
 *   node scripts/calibrate.mjs --games 8 --size 9 --pairs 1-12
 *   node scripts/calibrate.mjs --games 4 --size 19 --pairs 12-15   （慢，主模型档）
 *
 * 输出：
 *   data/calibration/<timestamp>.jsonl   每盘一行（谁赢、手数、scoreLead）
 *   data/ranks.json                      覆盖写（带 sample / measuredAt）
 *
 * 原理：等级是相对量。以 8 级 = 1525 为锚，相邻两级的胜率换成分数差
 *   Δ = 400 × log10(w / (1 - w))
 * 再向两侧累加，得到 A_k。样本少时置信区间很宽，所以每级都记 sample。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GtpSession, LEVEL_PARAMS, levelParams } from '../packages/engine/dist/index.js';
import { Game } from '../packages/rules/dist/index.js';
import { PASS, gtpToVertex, vertexToGtp } from '../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const GAMES = Number(arg('games', 8));
const SIZE = Number(arg('size', 9));
const KOMI = 7.5;
const PORTS = String(arg('pairs', '1-12')).split(',').map((s) => s.split('-').map(Number));
const ANCHOR_LEVEL = 8;
const ANCHOR_RATING = 1525;
/** 落后这么多目就认输，省时间（也是"棋力差太多"的自然表现） */
const RESIGN_LEAD = -25;
const MAX_MOVES = SIZE === 9 ? 160 : 320;

const BIN = path.join(ROOT, 'data/engine/katago-cuda/katago.exe');
const MODEL = path.join(ROOT, 'data/models/b18c384nbt-uec.bin.gz');
const HUMAN = path.join(ROOT, 'data/models/b18c384nbt-humanv0.bin.gz');
const CFG = path.join(ROOT, 'data/engine/katago-cuda/xingyi.cfg');

if (!fs.existsSync(BIN)) {
  console.error('找不到 katago：', BIN);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(ROOT, 'data/calibration');
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, `${stamp}.jsonl`);
const log = fs.createWriteStream(logFile, { flags: 'a' });

const session = new GtpSession({
  binary: BIN,
  args: ['gtp', '-model', MODEL, '-config', CFG, '-human-model', HUMAN],
});

const isHuman = (level) => levelParams(level).kind === 'human';

async function setLevel(level) {
  const p = levelParams(level);
  await session.send(`kata-set-param maxVisits ${p.maxVisits}`);
  if (p.profile) {
    // 关键：humanSLChosenMoveProp 默认 0 = 完全不用人类模型选点，必须设 1
    await session.send(
      'kata-set-params ' +
        JSON.stringify({
          humanSLProfile: p.profile,
          humanSLChosenMoveProp: 1.0,
          humanSLChosenMovePiklLambda: 1e9,
          humanSLChosenMoveIgnorePass: true,
        }),
    );
  } else {
    await session.send('kata-set-params ' + JSON.stringify({ humanSLProfile: '', humanSLChosenMoveProp: 0 }));
  }
}

function parseGenmove(resp) {
  const lines = resp.split('\n');
  const play = lines.find((l) => l.startsWith('play '));
  const move = play ? play.slice(5).trim() : 'pass';
  const infos = lines.filter((l) => l.startsWith('info '));
  const last = infos[infos.length - 1] ?? '';
  const m = /scoreLead (-?\d+(?:\.\d+)?)/.exec(last);
  return { move, scoreLead: m ? Number(m[1]) : NaN };
}

/** 一盘：black 用 levelBlack，white 用 levelWhite。返回 {winner, reason, plies} */
async function playGame(levelBlack, levelWhite) {
  const game = new Game({ size: SIZE, komi: KOMI });
  await session.send(`boardsize ${SIZE}`, 20000);
  await session.send('clear_board', 20000);
  await session.send(`komi ${KOMI}`, 20000);

  let resignBy = null;
  let plies = 0;
  while (game.status === 'playing' && plies < MAX_MOVES) {
    const color = game.toPlay;
    const level = color === 'B' ? levelBlack : levelWhite;
    await setLevel(level);
    const resp = await session.send(`kata-genmove_analyze ${color} interval 100000 maxmoves 2`, 300000);
    const { move, scoreLead } = parseGenmove(resp);

    if (Number.isFinite(scoreLead) && scoreLead < RESIGN_LEAD && plies >= 40) {
      resignBy = color;
      break;
    }

    const vertex = move === 'pass' ? PASS : gtpToVertex(SIZE, move);
    const res = game.play(color, vertex);
    if (!res.ok) {
      throw new Error(`引擎给了非法着法 ${move}（${color}）：${res.message} —— ${vertexToGtp(SIZE, vertex)}`);
    }
    plies += 1;
  }

  let winner = null;
  let reason = 'score';
  if (resignBy) {
    winner = resignBy === 'B' ? 'W' : 'B';
    reason = 'resign';
  } else if (game.status !== 'playing') {
    winner = game.finishByScore([]).detail.winner;
  } else {
    // 到 MAX_MOVES 还没完：按当前盘面数子
    winner = game.score([]).winner;
    reason = 'truncated';
  }
  if (!winner) winner = 'B'; // 和棋在本体系里极少，按黑胜记，样本里会标记
  return { winner, reason, plies, resignBy };
}

async function main() {
  session.start();
  await session.send('boardsize ' + SIZE, 30000);
  console.log(`校准开始：${GAMES} 盘/组 · ${SIZE} 路 · 锚点 ${ANCHOR_LEVEL} 级 = ${ANCHOR_RATING}`);
  console.log(`日志：${logFile}`);

  const pairs = [];
  for (const [a, b] of PORTS) {
    for (let k = a; k < b; k++) pairs.push([k, k + 1]);
  }

  const results = [];
  for (const [lo, hi] of pairs) {
    let loWins = 0;
    let games = 0;
    const started = Date.now();
    for (let i = 0; i < GAMES; i++) {
      const loIsBlack = i % 2 === 0;
      const r = await playGame(loIsBlack ? lo : hi, loIsBlack ? hi : lo);
      const loWon = (r.winner === 'B') === loIsBlack;
      if (loWon) loWins += 1;
      games += 1;
      log.write(
        JSON.stringify({
          pair: [lo, hi],
          game: i + 1,
          loColor: loIsBlack ? 'B' : 'W',
          winner: r.winner,
          loWon,
          reason: r.reason,
          plies: r.plies,
          ms: Date.now() - started,
        }) + '\n',
      );
      process.stdout.write(
        `\r  ${lo} vs ${hi}：${games}/${GAMES} 盘，低级胜 ${loWins}（${r.reason}/${r.plies}手）   `,
      );
    }
    const p = (loWins + 0.5) / (games + 1); // 拉普拉斯平滑，避免 0/1 时 log 爆炸
    const delta = 400 * Math.log10(p / (1 - p));
    results.push({ lo, hi, loWins, games, delta, human: isHuman(lo) || isHuman(hi) });
    console.log(
      `\n  → ${lo} 级对 ${hi} 级：${loWins}/${games}，Δ = ${delta.toFixed(1)} 分（${(p * 100).toFixed(0)}%）`,
    );
  }

  // 从锚点向两侧累加。delta 定义为 R_lo − R_hi，所以：
  //   高一级的分数 = 低一级分数 − delta
  const rating = new Map([[ANCHOR_LEVEL, ANCHOR_RATING]]);
  const byLo = new Map(results.map((r) => [r.lo, r]));
  for (let k = ANCHOR_LEVEL; k < 15; k++) {
    const r = byLo.get(k);
    if (!r) break;
    rating.set(k + 1, (rating.get(k) ?? ANCHOR_RATING) - r.delta);
  }
  for (let k = ANCHOR_LEVEL; k > 1; k--) {
    const r = byLo.get(k - 1);
    if (!r) break;
    rating.set(k - 1, (rating.get(k) ?? ANCHOR_RATING) + r.delta);
  }

  console.log('\n校准结果：');
  const ranksPath = path.join(ROOT, 'data/ranks.json');
  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(ranksPath, 'utf8'));
  } catch {
    existing = null;
  }
  const existingByLevel = new Map((existing?.levels ?? []).map((l) => [l.level, l]));

  const levels = [];
  for (let k = 1; k <= 15; k++) {
    const r = rating.get(k);
    const prev = existingByLevel.get(k);
    // 这一级的样本 = 与上一级、下一级两组对局之和
    const sample = (byLo.get(k)?.games ?? 0) + (byLo.get(k - 1)?.games ?? 0);
    const measured = r !== undefined;
    levels.push({
      level: k,
      rating: measured ? Math.round(r) : (prev?.rating ?? null),
      calibrated: measured ? sample >= 6 : Boolean(prev?.calibrated),
      sample: measured ? sample : (prev?.sample ?? 0),
      measuredAt: measured ? stamp : prev?.measuredAt,
    });
    console.log(
      `  ${String(k).padStart(2)} 级：` +
        (measured
          ? `${Math.round(r)}  样本 ${sample}${sample < 6 ? '（偏少）' : ''}`
          : `${prev?.rating ?? '—'}（沿用旧值，本次未测）`),
    );
  }

  const table = {
    maxLevel: 15,
    calibrated: levels.every((l) => l.calibrated),
    calibratedAt: stamp,
    size: SIZE,
    gamesPerPair: GAMES,
    anchor: { level: ANCHOR_LEVEL, rating: ANCHOR_RATING },
    levels,
  };
  fs.writeFileSync(ranksPath, JSON.stringify(table, null, 2) + '\n');
  console.log('\n已写入 data/ranks.json');

  session.stop();
  log.end();
  setTimeout(() => process.exit(0), 500);
}

main().catch((err) => {
  console.error('\n校准失败：', err);
  session.stop();
  process.exit(1);
});
