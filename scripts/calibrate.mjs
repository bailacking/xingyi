#!/usr/bin/env node
/** 19 路分先校准。每个开局一对换色对局，记录引擎与参数指纹。 */
// node scripts/calibrate.mjs --size 19 --games 60 --pairs 1-25
// node scripts/calibrate.mjs --games 24 --pairs 7:9 --opening-offset 30 --ladder data/calibration/ladder.json
// 续跑时保留棋盘、开局索引和引擎配置，使用 --resume <日志路径>。
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
const SIZE = Number(arg('size', 19));
const KOMI = 7.5;
const PLY_CAP = SIZE === 9 ? 200 : SIZE === 13 ? 300 : 420;
const ADJ_LEVEL = 1;
const DEAD_TH = 0.5;
const OPENING_OFFSET = Number(arg('opening-offset', 0));
const PAIRS = [...new Map(String(arg('pairs', '1-25')).split(',').flatMap((range) => {
  const [a, b] = range.split(/[-:]/).map(Number);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > LEVEL_PARAMS.length || a >= b) {
    throw new Error('对测范围用 1-25，指定两级用 4:7');
  }
  const pairs = range.includes(':') ? [[a, b]] : Array.from({ length: b - a }, (_, i) => [a + i, a + i + 1]);
  return pairs.map((pair) => [pair.join('-'), pair]);
})).values()];
if (![9, 13, 19].includes(SIZE) || !Number.isInteger(GAMES) || GAMES < 2 || GAMES % 2 !== 0 ||
    !Number.isInteger(OPENING_OFFSET) || OPENING_OFFSET < 0 || OPENING_OFFSET + GAMES / 2 > 8000) {
  throw new Error('路数仅支持 9/13/19，盘数须为偶数，开局索引须小于 8000');
}

const localConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config.json'), 'utf8').replace(/^\uFEFF/, '')).engine;
const { binaryPath: BIN, modelPath: MODEL, humanModelPath: HUMAN, configPath: CFG } = localConfig;
if (!BIN || !MODEL || !HUMAN || !CFG) throw new Error('请先在设置里配置引擎、主模型、人类模型和 GTP 配置');
const OUT_DIR = path.join(ROOT, 'data/calibration');

const fileHash = async (file) => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

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

// 从不同角的三三、星位、大小目附近组合四手开局。每组同一开局交换黑白。
const cornerOrders = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2], [0, 1, 3, 2], [0, 2, 3, 1], [0, 3, 2, 1]];
const patterns = [[0, 0], [0, 1], [1, 0], [1, 1], [0, 2], [2, 0], [1, 2]];
function openingFor(index) {
  if (index === 0) return [];
  // 乘互质数打散索引；四角的坐标组合与下子顺序无重复。
  let key = (index * 451) % (cornerOrders.length * patterns.length ** 4);
  const corners = cornerOrders[key % cornerOrders.length];
  key = Math.floor(key / cornerOrders.length);
  const offset = SIZE === 9 ? 1 : 2;
  return corners.map((corner) => {
    const [dx, dy] = patterns[key % patterns.length];
    key = Math.floor(key / patterns.length);
    const x = corner % 2 === 0 ? offset + dx : SIZE - 1 - offset - dx;
    const y = corner < 2 ? offset + dy : SIZE - 1 - offset - dy;
    return 'ABCDEFGHJKLMNOPQRST'[x] + String(SIZE - y);
  });
}

/* ---------------- 引擎 ---------------- */

const session = new GtpSession({
  binary: BIN,
  args: ['gtp', '-model', MODEL, '-config', CFG, '-human-model', HUMAN, ...(localConfig.extraArgs ?? [])],
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
  if (!line) throw new Error('KataGo 未返回有效落子');
  return line.slice(5).trim();
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
  await session.send('clear_cache', 20000);
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
    if (move === 'resign') throw new Error('校准局不接受认输');
    const vertex = move === 'pass' ? PASS : gtpToVertex(SIZE, move);
    if (vertex === PASS && move.toLowerCase() !== 'pass') throw new Error('引擎返回非法坐标 ' + move);
    const res = game.play(turn, vertex);
    if (!res.ok) throw new Error(`引擎给了非法着法 ${move}（${turn}）：${res.message}`);
    plies += 1;
  }

  const capped = game.status === 'playing';
  const adj = await adjudicate(game);
  return { winner: adj.winner, margin: adj.margin, dead: adj.dead, plies, capped, adjudicated: adj.adjudicated };
}

/* ---------------- 日志 ---------------- */

function openLog(resumeFile, environment) {
  if (resumeFile) {
    const f = path.resolve(ROOT, resumeFile);
    if (!fs.existsSync(f)) throw new Error(`续跑文件不存在：${f}`);
    return { file: f, stream: fs.createWriteStream(f, { flags: 'a' }), resumed: true };
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const f = path.join(OUT_DIR, `${stamp}-${crypto.randomBytes(3).toString('hex')}.jsonl`);
  const stream = fs.createWriteStream(f, { flags: 'wx' });
  stream.write(
    JSON.stringify({
      type: 'meta',
      version: 3,
      openingOffset: OPENING_OFFSET,
      environment,
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
  const environment = {
    binary: await fileHash(BIN), main: await fileHash(MODEL), human: await fileHash(HUMAN),
    config: await fileHash(CFG), args: localConfig.extraArgs ?? [],
  };
  const out = openLog(arg('resume', null), environment);
  const done = readDone(out.file);
  if (out.resumed) {
    const meta = JSON.parse(fs.readFileSync(out.file, 'utf8').split('\n')[0]);
    if (meta.version !== 3 || meta.ladderHash !== LADDER_HASH || meta.size !== SIZE || meta.openingOffset !== OPENING_OFFSET ||
        JSON.stringify(meta.environment) !== JSON.stringify(environment)) {
      console.error('拒绝续跑：日志版本、路数、开局索引、阶梯或引擎指纹不一致');
      process.exit(2);
    }
  }

  session.start();
  await session.send('name', 30000);
  const version = await session.send('version', 20000);
  await session.send('kata-set-rules chinese');
  await session.send('kata-set-param allowResignation false');
  console.log(`引擎 ${String(version).trim()} · ${GAMES} 盘/组 · ${SIZE} 路 · 阶梯 ${LADDER_HASH}（应用 ${APP_LADDER_HASH}）`);
  console.log(`日志：${path.relative(ROOT, out.file)}${out.resumed ? `（续跑，已完成 ${done.size} 盘）` : ''}`);

  for (const [lo, hi] of PAIRS) {
    const times = [];
    let skipped = 0;
    for (let i = 0; i < GAMES; i++) {
      if (done.has(`${lo}-${hi}-${i + 1}`)) {
        skipped += 1;
        continue;
      }
      const loIsBlack = i % 2 === 0;
      const openingIndex = OPENING_OFFSET + Math.floor(i / 2);
      const opening = openingFor(openingIndex);
      const started = Date.now();
      const r = await playGame(loIsBlack ? lo : hi, loIsBlack ? hi : lo, opening);
      const ms = Date.now() - started;
      times.push(ms);
      out.stream.write(
        JSON.stringify({
          pair: [lo, hi],
          game: i + 1,
          opening,
          openingIndex,
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
  console.log(`\n完成。诊断：node scripts/fit-ranks.mjs ${path.relative(ROOT, out.file)}`);
}

main().catch((err) => {
  console.error(err);
  session.stop();
  process.exit(1);
});
