#!/usr/bin/env node
/**
 * 等级校准 v2（2026-10-18 重写）
 *
 * 相对 v1 改了四件事，都是为了把标签噪声压下去：
 *  1. **成对开局**：同一起始局面正反各下一盘（颜色互换），消掉开局方差
 *  2. **不认输**：v1 用 humanSL 自评的 scoreLead 判认输，低段模型自评不可靠
 *  3. **终局用主模型标死子**：v1 双 pass / 截断后直接数子，盘上死子没算，胜负会被判错
 *  4. **参数指纹**：jsonl 首行写 meta（等级表哈希、引擎版本、规则），拟合脚本据此拒绝混轮次
 *
 * 用法：
 *   node scripts/calibrate.mjs --games 24 --pairs 1-12
 *   node scripts/calibrate.mjs --games 60 --pairs 1-12 --ladder data/calibration/ladder-x.json
 *   node scripts/calibrate.mjs --resume data/calibration/<file>.jsonl --games 60 --pairs 1-12
 *
 * 等级表默认取应用正在用的 `LEVEL_PARAMS`；`--ladder` 只是实验用，
 * 拟合时会比对哈希，实验阶梯的数据不允许写进 `data/ranks.json`。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GtpSession, LEVEL_PARAMS, levelParams, parseAnalyzeLine } from '../packages/engine/dist/index.js';
import { Game } from '../packages/rules/dist/index.js';
import { PASS, gtpToVertex } from '../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const GAMES = Number(arg('games', 24));
const SIZE = Number(arg('size', 9));
const KOMI = 7.5;
const PLY_CAP = SIZE === 9 ? 200 : SIZE === 13 ? 300 : 420;
const ADJ_LEVEL = 12;
const DEAD_TH = 0.5;
const PORTS = String(arg('pairs', '1-12'))
  .split(',')
  .map((s) => s.split('-').map(Number));

const BIN = path.join(ROOT, 'data/engine/katago-cuda/katago.exe');
const MODEL = path.join(ROOT, 'data/models/b18c384nbt-uec.bin.gz');
const HUMAN = path.join(ROOT, 'data/models/b18c384nbt-humanv0.bin.gz');
const CFG = path.join(ROOT, 'data/engine/katago-cuda/xingyi.cfg');
const OUT_DIR = path.join(ROOT, 'data/calibration');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 等级表 ---------------- */

function ladderFromParams() {
  return LEVEL_PARAMS.map((p) => ({
    level: p.level,
    profile: p.profile,
    maxVisits: p.maxVisits,
    lambda: p.lambda ?? (p.profile ? 1e8 : 0),
    rootExplore: p.rootExplore ?? 0,
    temperature: null,
  }));
}

const fingerprint = (arr) =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify(arr.map((l) => [l.level, l.profile, l.maxVisits, l.lambda, l.rootExplore, l.temperature])))
    .digest('hex')
    .slice(0, 12);

function loadLadder() {
  const f = arg('ladder', null);
  if (!f) return ladderFromParams();
  const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.levels;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('ladder 文件格式不对');
  return arr.map((x) => ({
    level: x.level,
    profile: x.profile ?? null,
    maxVisits: x.maxVisits ?? 1,
    lambda: x.lambda ?? (x.profile ? 1e8 : 0),
    rootExplore: x.rootExplore ?? 0,
    temperature: x.temperature ?? null,
  }));
}

const LADDER = loadLadder();
const LADDER_BY_LEVEL = new Map(LADDER.map((l) => [l.level, l]));
const LADDER_HASH = fingerprint(LADDER);
const APP_LADDER_HASH = fingerprint(ladderFromParams());

const stepOf = (level) => LADDER_BY_LEVEL.get(level) ?? levelParams(level);

/* ---------------- 开局库（成对使用） ---------------- */

const OPENINGS = {
  9: [[], ['E5'], ['E5', 'C3'], ['E5', 'C3', 'G7'], ['C3', 'G7', 'E5'], ['E5', 'G3', 'C7']],
  13: [[], ['G7'], ['G7', 'D4'], ['G7', 'D4', 'K10'], ['D4', 'K10', 'G7']],
  19: [[], ['D4'], ['Q16'], ['D4', 'Q16'], ['D4', 'Q16', 'Q4'], ['D4', 'Q16', 'Q4', 'D16']],
};

/* ---------------- 引擎 ---------------- */

const session = new GtpSession({
  binary: BIN,
  args: ['gtp', '-model', MODEL, '-config', CFG, '-human-model', HUMAN],
});

async function setLevel(level) {
  const p = stepOf(level);
  await session.send(`kata-set-param maxVisits ${p.maxVisits}`);
  const params = {
    humanSLProfile: p.profile ?? '',
    humanSLChosenMoveProp: p.profile ? 1.0 : 0,
    humanSLChosenMovePiklLambda: p.lambda,
    humanSLChosenMoveIgnorePass: true,
    humanSLRootExploreProbWeightless: p.rootExplore,
  };
  if (p.temperature !== null) {
    params.chosenMoveTemperature = p.temperature;
    params.chosenMoveTemperatureEarly = p.temperature;
    params.chosenMoveTemperatureOnlyBelowProb = 1.0;
  }
  await session.send(`kata-set-params ${JSON.stringify(params)}`);
}

function parseMove(resp) {
  const line = resp.split('\n').find((l) => l.startsWith('play '));
  return line ? line.slice(5).trim() : 'pass';
}

/** 终局裁决：主模型 ownership 标死子后数子 */
async function adjudicate(game) {
  if (game.status === 'playing') game.stop();
  await setLevel(ADJ_LEVEL);
  await session.send('kata-set-param maxVisits 400').catch(() => undefined);
  let own = null;
  session.beginAnalysis((line) => {
    const parsed = parseAnalyzeLine(line, game.size);
    if (parsed.ownership) own = parsed.ownership;
  });
  // interval 是厘秒：给 10（100ms）才有周期性输出；给 100000 会一直等到搜索结束才吐一行
  session.writeRaw('kata-analyze B interval 10 maxmoves 1 ownership true');
  const t0 = Date.now();
  while (!own && Date.now() - t0 < 5000) await sleep(80);
  session.endAnalysis();
  await sleep(80);

  const dead = [];
  const grid = game.board.grid;
  if (own && own.length === grid.length) {
    for (let v = 0; v < grid.length; v++) {
      const c = game.board.at(v);
      if (c === 0) continue;
      const o = own[v];
      if (c === 1 && o < -DEAD_TH) dead.push(v);
      if (c === 2 && o > DEAD_TH) dead.push(v);
    }
  }
  const { detail } = game.finishByScore(dead);
  return { winner: detail.winner, margin: detail.margin, dead: dead.length, adjudicated: Boolean(own) };
}

/** 下一盘。kata-genmove_analyze 会自己落子，只有人工开局需要额外 play。 */
async function playGame(levelBlack, levelWhite, opening) {
  const game = new Game({ size: SIZE, komi: KOMI });
  await session.send(`boardsize ${SIZE}`, 20000);
  await session.send('clear_board', 20000);
  await session.send(`komi ${KOMI}`, 20000);

  let plies = 0;
  let color = 'B';
  for (const v of opening) {
    const res = game.play(color, gtpToVertex(SIZE, v));
    if (!res.ok) throw new Error(`开局着法非法 ${v}`);
    await session.send(`play ${color} ${v}`, 20000);
    color = color === 'B' ? 'W' : 'B';
    plies += 1;
  }

  while (game.status === 'playing' && plies < PLY_CAP) {
    const turn = game.toPlay;
    await setLevel(turn === 'B' ? levelBlack : levelWhite);
    const resp = await session.send(`kata-genmove_analyze ${turn} interval 100000 maxmoves 1`, 300000);
    const move = parseMove(resp);
    const vertex = move === 'pass' ? PASS : gtpToVertex(SIZE, move);
    const res = game.play(turn, vertex);
    if (!res.ok) throw new Error(`引擎给了非法着法 ${move}（${turn}）：${res.message}`);
    plies += 1;
  }

  const capped = game.status === 'playing';
  const adj = await adjudicate(game);
  return { winner: adj.winner, margin: adj.margin, dead: adj.dead, plies, capped, adjudicated: adj.adjudicated };
}

/* ---------------- 日志 ---------------- */

function openLog(resumeFile) {
  if (resumeFile) {
    const f = path.resolve(ROOT, resumeFile);
    if (!fs.existsSync(f)) throw new Error(`续跑文件不存在：${f}`);
    return { file: f, stream: fs.createWriteStream(f, { flags: 'a' }), resumed: true };
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const f = path.join(OUT_DIR, `${stamp}.jsonl`);
  const stream = fs.createWriteStream(f, { flags: 'a' });
  stream.write(
    JSON.stringify({
      type: 'meta',
      version: 2,
      createdAt: new Date().toISOString(),
      size: SIZE,
      komi: KOMI,
      gamesPerPair: GAMES,
      plyCap: PLY_CAP,
      deadThreshold: DEAD_TH,
      ladderHash: LADDER_HASH,
      appLadderHash: APP_LADDER_HASH,
      ladder: LADDER,
      engine: { binary: BIN, model: MODEL, humanModel: HUMAN, config: CFG },
    }) + '\n',
  );
  return { file: f, stream, resumed: false };
}

function readDone(file) {
  const done = new Set();
  if (!fs.existsSync(file)) return done;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.type === 'meta') continue;
      done.add(`${r.pair[0]}-${r.pair[1]}-${r.game}`);
    } catch {
      /* 半行忽略 */
    }
  }
  return done;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  if (!fs.existsSync(BIN)) {
    console.error('找不到 katago：', BIN);
    process.exit(1);
  }
  const out = openLog(arg('resume', null));
  const done = readDone(out.file);
  if (out.resumed) {
    const meta = JSON.parse(fs.readFileSync(out.file, 'utf8').split('\n')[0]);
    if (meta.ladderHash && meta.ladderHash !== LADDER_HASH) {
      console.error(`拒绝续跑：文件里的阶梯哈希 ${meta.ladderHash} ≠ 当前 ${LADDER_HASH}`);
      process.exit(2);
    }
  }

  session.start();
  await session.send('name', 30000);
  const version = await session.send('version', 20000).catch(() => '?');
  console.log(`引擎 ${String(version).trim()} · ${GAMES} 盘/组 · ${SIZE} 路 · 阶梯 ${LADDER_HASH}（应用 ${APP_LADDER_HASH}）`);
  console.log(`日志：${path.relative(ROOT, out.file)}${out.resumed ? `（续跑，已完成 ${done.size} 盘）` : ''}`);

  const pairs = [];
  for (const [a, b] of PORTS) for (let k = a; k < b; k++) pairs.push([k, k + 1]);

  for (const [lo, hi] of pairs) {
    const times = [];
    let skipped = 0;
    for (let i = 0; i < GAMES; i++) {
      if (done.has(`${lo}-${hi}-${i + 1}`)) {
        skipped += 1;
        continue;
      }
      const loIsBlack = i % 2 === 0;
      const openingList = OPENINGS[SIZE] ?? [[]];
      const opening = openingList[Math.floor(i / 2) % openingList.length];
      const started = Date.now();
      const r = await playGame(loIsBlack ? lo : hi, loIsBlack ? hi : lo, opening);
      const ms = Date.now() - started;
      times.push(ms);
      out.stream.write(
        JSON.stringify({
          pair: [lo, hi],
          game: i + 1,
          opening,
          loColor: loIsBlack ? 'B' : 'W',
          winner: r.winner,
          loWon: r.winner === (loIsBlack ? 'B' : 'W'),
          margin: r.margin,
          dead: r.dead,
          capped: r.capped,
          adjudicated: r.adjudicated,
          plies: r.plies,
          ms,
        }) + '\n',
      );
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      process.stdout.write(
        `\r  ${lo}v${hi}: ${i + 1}/${GAMES}  均 ${(avg / 1000).toFixed(1)}s/盘  ${r.winner} 胜 ${r.margin} 目  `.padEnd(72),
      );
    }
    console.log(skipped ? `\n  ${lo}v${hi}: 跳过 ${skipped} 盘（已完成）` : '');
  }
  out.stream.end();
  session.stop();
  console.log(`\n完成。拟合：node scripts/fit-ranks.mjs ${path.relative(ROOT, out.file)} --write`);
}

main().catch((err) => {
  console.error(err);
  session.stop();
  process.exit(1);
});
