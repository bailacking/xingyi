#!/usr/bin/env node
/**
 * 假 KataGo：只实现星弈用到的 GTP 子集，用来验证**我们这一侧**的协议层。
 * 真引擎行为依据 docs/GTP_Extensions.md；这个脚本不是仿真器，别拿它测棋力。
 *
 * 用法（测试里）：node fake-katago.mjs gtp -model whatever
 */
import readline from 'node:readline';

const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
let size = 19;
let grid = new Array(size * size).fill(0);
let analyzing = null;
let params = { maxVisits: 500, humanSLProfile: 'rank_6k' };

function gtp(index) {
  const x = index % size;
  const y = Math.floor(index / size);
  return `${LETTERS[x]}${size - y}`;
}

function fromGtp(s) {
  if (s === 'pass') return -1;
  const x = LETTERS.indexOf(s[0].toUpperCase());
  const row = Number(s.slice(1));
  const y = size - row;
  if (x < 0 || !Number.isFinite(row)) return -1;
  return y * size + x;
}

function out(result) {
  return result === '' ? '=\n\n' : `= ${result}\n\n`;
}

function stopAnalyze() {
  if (analyzing) {
    clearInterval(analyzing);
    analyzing = null;
  }
}

function emitAnalysis(color, count) {
  const empties = [];
  for (let i = 0; i < grid.length; i++) if (!grid[i]) empties.push(i);
  const picks = empties.slice(0, Math.max(1, count));
  const ownership = new Array(size * size).fill('0.5').join(' ');
  // 真 KataGo 的格式：把多个 info 段串在**同一行**，最后接 rootInfo 与 ownership
  const infos = picks.map((idx, order) => {
    const visits = (order + 1) * 37;
    return (
      `info move ${gtp(idx)} visits ${visits} edgeVisits ${visits} utility -0.1 ` +
      `winrate ${(0.55 - order * 0.02).toFixed(4)} scoreMean ${(2 - order * 0.3).toFixed(2)} ` +
      `scoreLead ${(2 - order * 0.3).toFixed(2)} prior ${(0.2 - order * 0.01).toFixed(3)} ` +
      `order ${order} pv ${gtp(idx)} ${gtp(picks[picks.length - 1])}`
    );
  });
  process.stdout.write(
    `${infos.join(' ')} rootInfo visits 400 winrate 0.5500 scoreLead 1.50 ownership ${ownership}
`,
  );
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (raw) => {
  const line = raw.trim();
  if (line === '') {
    // 原始换行 = 终止分析流（KataGo 文档行为），不产生响应
    stopAnalyze();
    return;
  }
  stopAnalyze();
  const m = /^(\d*)\s*(.*)$/.exec(line);
  const id = m[1] ?? '';
  const body = (m[2] ?? '').trim();
  const [cmd, ...rest] = body.split(/\s+/);
  const prefix = id ? `${id} ` : '';
  const reply = (payload) => process.stdout.write(`${prefix}${payload}`);

  switch (cmd) {
    case 'name':
      reply(out('FakeKataGo'));
      break;
    case 'version':
      reply(out('1.15.3-fake'));
      break;
    case 'protocol_version':
      reply(out('2'));
      break;
    case 'boardsize': {
      const n = Number(rest[0]);
      if (!Number.isInteger(n) || n < 2) {
        reply('? unacceptable size\n\n');
      } else {
        size = n;
        grid = new Array(size * size).fill(0);
        reply(out(''));
      }
      break;
    }
    case 'clear_board':
      grid = new Array(size * size).fill(0);
      reply(out(''));
      break;
    case 'komi':
    case 'time_settings':
    case 'kata-set-param':
    case 'kata-set-params':
      if (cmd === 'kata-set-param') params[rest[0]] = rest.slice(1).join(' ');
      reply(out(''));
      break;
    case 'kata-get-params':
      reply(out(JSON.stringify(params)));
      break;
    case 'kata-list-params':
      reply(out('maxVisits humanSLProfile playoutDoublingAdvantage analysisIgnorePreRootHistory'));
      break;
    case 'kata-get-models':
      reply(out(JSON.stringify([{ name: 'fake-main', usesHumanSLProfile: true }])));
      break;
    case 'play': {
      const color = rest[0] === 'B' ? 1 : 2;
      const v = fromGtp(rest[1] ?? 'pass');
      if (v === -1) {
        reply(out(''));
      } else if (grid[v]) {
        reply('? illegal move\n\n');
      } else {
        grid[v] = color;
        reply(out(''));
      }
      break;
    }
    case 'genmove': {
      const color = rest[0] === 'B' ? 1 : 2;
      const idx = grid.findIndex((c) => c === 0);
      if (idx < 0) {
        reply(out('pass'));
      } else {
        grid[idx] = color;
        reply(out(gtp(idx)));
      }
      break;
    }
    case 'kata-analyze': {
      const color = (rest[0] ?? 'B').toUpperCase();
      let interval = 10;
      const rest2 = rest.slice(1);
      for (let i = 0; i < rest2.length; i++) {
        if (rest2[i] === 'interval') interval = Number(rest2[i + 1]) || 10;
      }
      // 真 KataGo 的行为：`=` 之后**紧接着** info 行，中间没有空行
      reply(`${prefix}=
`);
      // 之后异步输出分析行，直到收到换行/新命令
      let tick = 0;
      analyzing = setInterval(() => {
        tick += 1;
        emitAnalysis(color, 3);
        if (tick > 200) stopAnalyze();
      }, Math.max(5, interval * 10));
      break;
    }
    case 'quit':
      stopAnalyze();
      process.exit(0);
      break;
    default:
      reply(`? unknown command: ${cmd}\n\n`);
  }
});
