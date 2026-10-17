# AGENTS.md · 星弈开发手册

> **读者**：接手这个仓库的 AI 编程助手（以及偶尔看它的人）。
> **权威顺序**：本文件 > 代码 > `docs/` > `docs/archive/PLAN-v2.5.md`（历史设计稿，已弃用，只作考古）。
> **维护义务**：改动涉及状态、参数、契约、坑位时，**同一个 commit 里更新本文件**。本文件过期比没有更糟。
> **最后核对**：2026-10-17 23:55 · 71 项测试通过 · 引擎真机跑通并校准过一轮。

---

## 0. 开工前 60 秒

1. 读 §2「当前状态」——确认你要做的事**是否已经做了**。设计稿里有的东西，代码里可能没有；反之也有偏差。
2. 读 §6「不变量」与 §15「已踩过的坑」——这些是代价换来的，别重犯。
3. 改完必须跑通：`npm test`（71 项）+ `npm run typecheck`。
4. 能跑 ≠ 对。涉及界面的改动，用 §16.4 的无头浏览器截图目检；涉及引擎的，用真 katago 跑一次（本机已装，见 §9.1）。

---

## 1. 项目定位

**一句话**：在本机跑 KataGo 的围棋软件，以「练」为主线——修习（升级）、自在（自由）、手谈（联机）三套规则世界，外加摆棋分析、教学题库、可深度换主题。

**性质**：开源个人项目（MIT）+ 简历作品。

**两条硬约束（贯穿所有决策）**

| # | 约束 | 具体含义 |
|---|---|---|
| H1 | 零版权风险 | 题库/素材/音效必须能证明来源与授权；只用 CC0 / 公有领域 / 自建 |
| H2 | 别人必须能跑起来 | 不假设下载者有 NVIDIA 卡；引擎与权重用户自装，程序做环境自检 + 中文引导 |

**非目标**：不做在线对弈平台（不接 OGS/KGS/野狐）· 不做通用 SGF 编辑器 · 不做手机原生 App · 不做模型训练/自对弈 · 不做日本规则。

**术语**：等级一律叫「级」（1~15），不叫「段」不叫「档」。界面正文用中文数字（六级），印章用大写（陆级）。

---

## 2. 当前状态（唯一可信进度）

> 下面这行是给 AI 的防幻觉提示：**不要根据文件名或 CAPS 字段推断功能已实现**。

| 模块 | 状态 | 已实现 | 未实现 |
|---|---|---|---|
| **自在**（free） | 可玩 | 9/13/19 路对局；AI 或离线对手；悔棋、停一手、认输、终局数子；SGF 导入/导出；分析面板（候选点 + 胜率 + 目差）；形势图（F）；候选变化幽灵子；点一颗子整块标死 | 自由摆子编辑（AB/AW/AE 拖拽摆放）；目差曲线；沿分支逐手跳转；"假设对手水平"滑杆 |
| **修习**（ranked） | 可玩（等级表已实测） | 3 盘自适应定级；前 10 盘暂定级；升降级（阈值按局部步长）+ 保级期 + 退级缓冲；跳档考核字段；`progress.json` + `.bak`；评级沙盘（设置页） | 跳档考核局 UI 未接；逐级独立校准误差仍 ±150~480 |
| **手谈**（lan） | 未开始 | 仅 `Mode='lan'` 与 CAPS 占位 | 房间、发现、协议、观战、聊天全部未做 |
| 教学 / 题库 | 未开始 | `data/tsumego/`、`data/joseki/` 空目录 | 交互式教学、死活判题、10 题测级 |
| 主题 | 两套内置可用 | `walnut`（胡桃木，默认）+ `youth`（星弈·青）；即时切换 + 5 秒撤销 | 主题预览卡片；zip 导入导出；`style.css` 加载白名单 |
| Electron | 未开始 | — | 换壳、窗口、图标、启动画面 |
| 引擎 | 已接入真机 | GTP 串行客户端、分析流、三后端探测、五步自检、进程守护、离线对手 | 摆棋用的 `playoutDoublingAdvantage` 滑杆 |

**测试规模**：71 项 / 5 个文件（rules 17 · server API 13 · engine 14 · rating · sgf）。

**本机引擎现状**（`data/config.json`，不入库）：KataGo 1.18.2 CUDA + 主模型 + human 模型，显存占用 985 MB / 4096 MB。换机器时这份配置不存在 → 引擎状态为 `unconfigured`，自在模式自动退化为离线对手，修习模式返回 409。

---

## 3. 环境与命令

| 项 | 值 |
|---|---|
| 运行时 | Node ≥ 20（本机 22.22.2）、npm 10.9.7 |
| 包管理 | **npm workspaces**。不要引入 pnpm（H2：少一步安装） |
| 服务端口 | `7388`（`XINGYI_PORT` / `PORT` 可覆盖） |
| 前端 dev | `5173`（Vite，`/api` 与 `/ws` 代理到 7388） |
| 数据目录 | 开发期 `data/`，路径见 `server/src/paths.ts` |

| 命令 | 作用 | 备注 |
|---|---|---|
| `npm install` | 装依赖（workspaces 一次到位） | — |
| `npm run dev` | 先构建 packages，再并发起 server + web | 改 packages 需重启（有 `-b` 但 watch 不跨包） |
| `npm run build:packages` | `tsc -b` 四个包 | server/web 依赖它的 `dist/` |
| `npm run build` | packages + server + web | 前端产物由 server 托管 |
| `npm start` | 只跑生产服务（7388） | 需先 `npm run build` |
| `npm test` | 全量单测 | 引擎测试用假引擎进程，不需要真 KataGo |
| `npm run typecheck` | 全量类型检查 | CI 也跑这个 |
| `start.bat` / `start.bat prod` | Windows 一键启动 | **必须 CRLF**（`.gitattributes` 已锁） |
| `node scripts/calibrate.mjs --games 40 --pairs 1-12` | 等级校准 | 见 §9.6 |
| `node scripts/fit-ranks.mjs <jsonl>` | 保序回归拟合等级表 | 诊断用 |

**本机操作禁区**

- 停服务**按端口找 PID**：`Get-NetTCPConnection -LocalPort 7388 | ... | taskkill /PID <id> /T`。**禁止 `taskkill /F /IM node.exe`**——会连用户其它 node 进程一起杀（已经误伤过一次）。
- `git -C <path>` 在本机不可用，用 `( cd <path> && git ... )`。
- Bash 工具会拦截含 `powershell` / `pwsh` / `cmd` 字样的命令；需要时改用 PowerShell 工具。
- 下载外网文件需先开代理 `127.0.0.1:10808`（GitHub 直连不稳）。

---

## 4. 仓库地图

```
packages/
  shared/src/types.ts       前后端唯一类型来源：Color/Vertex/CAPS/GameSnapshot/ThemeTokens
  shared/src/coords.ts      index ↔ 坐标 ↔ GTP 顶点（A19 风格）
  rules/src/board.ts        盘面：落子/提子/气/自杀/superko/合法点
  rules/src/game.ts         对局状态机：play/preview/pass/undo/stop/finishByScore
  rules/src/score.ts        中国规则数子（含死子）
  rating/src/glicko.ts      简化 Glicko：期望胜率/步长/RD
  rating/src/progress.ts    定级赛/暂定级/升降级/存档结构
  rating/src/levels.ts      等级→校准分表（默认值 + normalize）
  rating/src/store.ts       progress.json 读写 + .bak + 损坏恢复
  engine/src/gtp.ts         GTP 行协议（串行队列、id、分析流 sink）
  engine/src/analyze.ts     kata-analyze 行解析（一行多段 + ownership）
  engine/src/manager.ts     引擎生命周期、等级参数、节流分析、守护
  engine/src/params.ts      15 级 → humanSLProfile / maxVisits
  engine/src/backend.ts     硬件探测与后端推荐
  engine/src/offline.ts     离线对手（启发式，带固定种子）
server/src/
  app.ts                    Fastify 实例、空 JSON body 兼容、错误格式
  api.ts                    全部 REST 路由
  gameService.ts            对局/结算/分析/进度/沙盘（业务中枢）
  match.ts                  一局 = rules.Game + 模式元信息 + AI 回合
  sgf.ts                    SGF 树解析 / 导出（AB/AW/PL/KM）
  config.ts                 config.json 结构与深合并
  paths.ts                  数据目录定位
web/src/
  App.tsx                   视图切换、主题、断线提示、?view= / ?theme= 调试直达
  board/Board.tsx           SVG 棋盘（几何、坐标、虚影、形势图、死子叉）
  modes/GameView.tsx        对局界面（三模式共用，靠 CAPS 分叉）
  modes/Menu.tsx            主界面
  panels/AnalysisPanel.tsx  候选点列表 + 胜率/目差 + 深入
  panels/MoveList.tsx       手数列表
  Settings.tsx              引擎三步向导 + 界面/音效/沙盘
  theme/skins.ts            两套 token + CSS 变量生成
  sound.ts                  WebAudio 合成音（3 音色 × 落子/提子/磬）
  api.ts / types.ts         请求封装 / 类型转发
scripts/calibrate.mjs       相邻级互下 → 拟合成等级表
scripts/fit-ranks.mjs       保序回归（含 95% 区间估算）
data/ranks.json             等级校准表（入库，唯一的数据类产物）
docs/                       引擎安装 / 评级说明 / 主题规范 / 测试清单
```

**不入库**：`data/engine/`、`data/models/`、`data/config.json`、`data/games/`、`data/calibration/`、`progress.json`、`backups/`、`logs/`、`gtp_logs/`。

---

## 5. 架构与数据流

```
浏览器（React）──REST / WS──▶ Node 服务（Fastify）
                               ├─ gameService：对局编排、AI 回合、结算、进度
                               ├─ packages/rules：唯一棋规实现（前端也用同一份）
                               └─ packages/engine：GTP 客户端（单进程、串行）
                                        │ stdin/stdout
                                   katago.exe + 主模型 + human 模型
```

关键流程（自在/修习共用）：

1. `POST /api/game` → `Match` 创建，`toPlay` 按 `playerColor` 决定；修习模式要求引擎已配置。
2. 玩家落子 → `gameService.humanMove` → `rules.Game.play`；成功后 `Match.maybeRunAi()`。
3. AI 回合：`engine.genmove(level)`（human 档位走 human SL，主模型档位限 visits）→ 落子 → `emit('game')`。
4. 结算：双方停手 → `status='scoring'` → 玩家点死子（整块）→ `finishScored` 数子 → `ranked` 模式写 `progress.json`。
5. 分析：`POST /api/game/:id/analyze` 固定在 **13 级（主模型 800 visits）** 跑，**不能用 human SL**——它评估的是"人类会怎么下"，不是"这盘谁好"。

**进程/并发**：单 katago 进程，请求串行队列；分析是异步流，新命令会打断旧流；AI 思考期间 `snapshot.aiThinking=true`，前端锁棋盘。

---

## 6. 不变量（违反会引发连锁 bug）

| # | 规则 | 说明 |
|---|---|---|
| I1 | 坐标 `index = y * size + x`（x 左→右，y 上→下）；`PASS = -1` | 不用 `null`/`undefined` 表示停一手 |
| I2 | 模式 = 能力门禁，唯一来源 `CAPS`（`packages/shared/src/types.ts`） | 禁止散落 `if (mode === 'ranked')`；控件**置灰 + 说明**，不隐藏 |
| I3 | 前后端类型只从 `@xingyi/shared` 出 | `web/src/types.ts` 只做 re-export，不加新类型 |
| I4 | 规则判定以**真落一手**为准 | 禁止手写"聪明"的合法性捷径（自杀误判就是这么做出来的） |
| I5 | 只做中国规则 | 数子、贴 7.5、让子不还子；不做日韩规则 |
| I6 | 等级上限读配置（`config.game.maxLevel`） | 不硬编码 15 |
| I7 | 面向用户的错误必须是中文 + 下一步 | 不出现 `engine init failed` |
| I8 | 主题包禁止 JS、禁止远程 URL | 见 §12 |
| I9 | `data/*` 里引擎与模型永不入库 | 版权 + 体积 |

`CAPS` 现状：

| 能力 | ranked | free | lan |
|---|---|---|---|
| showWinrate / showComment | ✗ | ✓ | ✓ |
| allowUndo | ✗ | ✓ | ✓（需对方同意，未实现） |
| allowAnalysis / allowImport | ✗ | ✓ | ✗ |
| rankLocked / allowLevelSelect | 锁定当前级 | 自选 1~15 | — |
| countsToProgress / quitLoses | ✓ / ✓ | ✗ / ✗ | ✗ / ✓ |
| allowBoardEdit | ✗ | ✓（字段已置 true，UI 未做） | ✗ |
| hasAi | ✓ | ✓ | ✗ |

---

## 7. 规则引擎 `@xingyi/rules`

**范围**：中国规则 · 提子 · 自杀禁止 · 简单劫 + positional superko · 数子（含死子）· 悔棋回放 · 停一手。

| 类型 | 关键方法 | 语义 |
|---|---|---|
| `Board` | `at / set / clone / groupAt / liberties` | 一维 `Int8Array` 盘面；0 空、1 黑、2 白 |
| `Board` | `isSuicide(color, v)` | **内部就是克隆后真落一手**，不要改回手写判断 |
| `Board` | `place(color, v)` | 返回 `{ok, captures, suicide, ...}`；提子与并气都在这里算 |
| `Board` | `legalMoves(color)` | 未过滤劫争，需再 `Game.preview` |
| `Game` | `play(color, v)` | 真实落子，写历史与 superko 集合 |
| `Game` | `preview(color, v)` | 试落一手只看结果，不改状态 |
| `Game` | `pass / undo(toPly) / stop / finishByScore(dead)` | `stop()` = 双方同意停手，不记 pass 手 |
| `score` | `scoreArea(size, grid, dead)` | 返回黑白地、子、目差、胜负文本 |

已知约束：

- `status`: `playing` → `scoring`（双方 pass 或 `stop()`）→ `finished`。
- `scoring` 阶段拒绝继续落子，错误信息是「双方已停手，先确认死子再结算」。
- 数子只认死子列表，不做"AI 建议死子"（P2 待接）。
- 测试里有一条 **200 手随机对局不变量**：盘上任何棋块气数必须 > 0。改动提子逻辑时它最先报警。

---

## 8. 评级系统 `@xingyi/rating`

**模型**：简化 Glicko（不是标准 Glicko-2）。

```
E  = 1 / (1 + 10^((A_k − R)/400))
R += K_eff × (S − E)
K_eff = K × (0.8 + 0.4 × min(|目差|/20, 1))
K = baseK + RD / rdScale      （RD 大 → K 大 → 新号收敛快）
```

| 参数 | 值 | 位置 |
|---|---|---|
| 初始 R / RD | 1500 / 350 | `RATING_PARAMS` |
| RD 下限 | 45 | 同上 |
| baseK / rdScale | 24 / 12 | 同上 |
| 暂定级 K 倍数 | ×2（前 10 盘） | `provisionalK` / `provisionalGames` |
| 同级刷分 | 超过 8 盘后 K × 0.5 | `repeatThreshold` / `repeatPenaltyK` |
| 速胜 | < 40 手按 S = 0.5 | `fastWinMoves` |
| 目差修正 | 0.8 ~ 1.2 | `diffKMin` / `diffKSpan` |
| 锚点 | 8 级 = 1525 | `data/ranks.json.anchor` |
| 每级步长 | **实测 100 分**（原设计 75，已作废） | `data/ranks.json.measuredStep` |

**升降级阈值**（`progress.evaluateLevel`）

| 动作 | 条件 |
|---|---|
| 升级 | `R ≥ A_{k+1} − 50` 且本级 ≥ 3 盘 且（连胜 ≥ 2 或本级胜率 ≥ 60%） |
| 跳档考核 | 连胜 ≥ 3 且够分且不在冷却 → 结算页「可进一级」，赢则升 1~2 级 |
| 降级 | 保级期 0 且退级缓冲 0 且 `R < A_{k−1} − 100` 且连败 ≥ 2 |
| 保级期 | 升入新级后 3 盘内不降 |
| 退级缓冲 | 降级后 5 盘内不连降 |

**定级赛**：第 1 盘 8 级 → 第 2 盘赢打 12 级 / 输打 4 级 → 第 3 盘按前两盘插值。前 10 盘标「暂定 X 级」，K 翻倍。

**存档**：`progress.json`（当前级、R、RD、暂定标记、历史、连胜、保级/冷却计数、`schemaVersion`）。每次写盘前留 `.bak`；读坏时回退 `.bak` 再回退默认值。

**校准现状（2026-10-18 定表）**：9 路 · 成对开局 · 每组 20 盘（两端 30 盘）· 共 **300 局**。
线性阶梯 **step = 90 分/级，95% 区间 [50, 131]**；14 个相邻组全部落在模型 ±8 个百分点内，没有显著反向的组。
`data/ranks.json` 的 A_k = 1525 + 90×(k−8)，全部 15 级 `calibrated: true`（每级 `ci95` 标的是逐级真实误差，±150~480）。
**别把 per-level 的 ci95 当成"没校准"**——数据量只够定斜率；要每级 ±25 得每组 ~800 盘（约 20 小时）。
细节与不完美之处见 `docs/评级说明.md` §八。

---

## 9. 引擎 `@xingyi/engine`

### 9.1 本机安装（已验证）

| 项 | 值 |
|---|---|
| 程序 | `data/engine/katago-cuda/katago.exe`（v1.18.2，CUDA 12.5 + cuDNN 9.8，9.4 MB） |
| 主模型 | `data/models/b18c384nbt-uec.bin.gz`（93 MB） |
| human 模型 | `data/models/b18c384nbt-humanv0.bin.gz`（94.5 MB） |
| 配置 | `data/engine/katago-cuda/xingyi.cfg`（12 线程 / 2 NN server / batch 6） |

**没装 CUDA Toolkit 也能跑**：本机没有 `nvcc`，但 PyTorch（cu126）自带 `cudart64_12 / cublas64_12 / cudnn*64_9 / nvrtc*`。把这些 DLL 复制到 `katago.exe` 同目录即可。完整清单见 `docs/引擎安装.md` §六。

### 9.2 实测数字（RTX 3050 Ti Laptop 4 GB）

| 指标 | 值 |
|---|---|
| 吞吐 | ≈ **540 visits/s**（12 线程 + 2 NN server + batch 6；默认 6 线程约 420） |
| 显存 | 主 + human 双模型同进程 **985 MB / 4096 MB** → 原风险 R2 不成立，不需要"按需切模型"降级链 |
| 开局 | 0.03 s |
| AI 应手 | < 1.2 s（8 级） |
| 分析 | **约 350 ms** 出 6 候选 + 361 点 ownership |

### 9.3 等级 → 引擎参数（`packages/engine/src/params.ts`）

| 级 | 机制 | profile / maxVisits |
|---|---|---|
| 1–2 | human SL | `rank_20k` / `rank_18k`，1 / 2 |
| 3–4 | human SL | `rank_16k` / `rank_14k`，4 / 8 |
| 5–6 | human SL | `rank_12k` / `rank_10k`，16 / 32 |
| 7–8 | human SL | `rank_8k` / `rank_6k`，64 / 100 |
| 9 | human SL | `rank_4k`，160 |
| 10–15 | 主模型 | 5 / 10 / 20 / 40 / 80 / 160 visits |

**为什么 10 级起就切主模型**（2026-10-18 实测）：human SL 到 `rank_1k` 后继续加访问量基本不再变强（240 与 320 visits 打平），
而主模型 **5 visits 就比 `rank_1k`+320 高约 140 分**。所以人类风格只保留到 9 级，10~15 用主模型低访问量做连续刻度。

**human SL 的可控性前提**：`humanSLChosenMoveProp=1` + `lambda`（PIKL 抑制）+ `rootExplore` 三者必须一起设。
- `lambda` 大（1e8）= 纯模仿，**搜索被忽略、`maxVisits` 对选点无效**（官方 `gtp_human5k_example.cfg` 明说）
- `lambda` 小（0.08~0.5）+ `rootExplore 0.8` = 搜索参与，`maxVisits` 才真的能调强度
- 当前 1~9 级固定 `lambda=0.5`、`rootExplore=0.8`

> 12 级以上用主模型还有另一个原因：官方警告 human SL 在高段不保证真实强度。
> 同级 AI 强度固定（只随机开局），保证"你的进步"可比较。

### 9.4 GTP 协议要点（全部实测，不是文档推测）

| 事实 | 后果 |
|---|---|
| 响应格式是 `[id] status content`，也接受 `= id content` | 解析要**先试 id 在前、再试 status 在前**；`= 1.15.3` 的版本号不能被 id 正则吃掉 |
| `kata-analyze` 的应答是 `=` 行**紧跟** info 行，中间没有空行 | 分析模式下遇到 `=` / `?` 直接吞掉，否则 info 全被当响应体 |
| 一行里串多个 `info` 段 + `rootInfo` + `ownership`（5000+ 字符） | 必须按段切分返回**数组**，不能一行一个候选 |
| `ownership` 是 361 个 [-1,1]，行主序 A19→T1 | 前端形势图直接用 |
| interval 单位是**厘秒** | 传 100 = 1 秒 |
| 新命令会终止正在流式输出的分析 | 分析前先 `stopAnalysis()`；`send` 走串行队列 |

### 9.5 human SL 的致命开关

只设 `humanSLProfile` **等于没设**——`humanSLChosenMoveProp` 默认是 `0`，意思是"不从人类模型选点"，1~11 级会一直用主模型下棋。必须一起设：

```text
kata-set-params {"humanSLProfile":"rank_8k","humanSLChosenMoveProp":1.0,
                 "humanSLChosenMovePiklLambda":1e9,"humanSLChosenMoveIgnorePass":true}
```

切回主模型档位：`kata-set-params {"humanSLProfile":"","humanSLChosenMoveProp":0}`。
**不要**用 `kata-set-param humanSLProfile ""`——它会把值设成两个引号字面量。

### 9.6 校准脚本

```bash
node scripts/calibrate.mjs --games 8 --size 9 --pairs 1-12   # 相邻级互下
node scripts/fit-ranks.mjs data/calibration/<stamp>.jsonl    # 保序回归 + 置信区间
```

- 结果写 `data/calibration/*.jsonl`（不入库）；`data/ranks.json` 只覆盖本次测过的级，**未测级沿用旧值**（第一版曾把整张表冲成常量）。
- 符号约定：`delta = R_lo − R_hi`，高一级 = 低一级 − delta。

### 9.7 离线对手（`offline.ts`）

- 固定种子 `mulberry32`，同一局面同一步，便于复现。
- 启发式：气数 + 提子 + 开拆/靠近上一手 + 边线惩罚（1 线 −1.6）。
- 局面定型判据：**空点 ≤ 28% 且剩余空点全落在某一方地里** → 停一手。28% 是经验值（C 类），不加密度前提会在空盘第一手就认输。
- **绝不用于修习结算**：`gameService.createMatch` 在 ranked 模式下要求 `engine.configured`，否则 409 + 中文原因。

---

## 10. HTTP API

全部 `/api`，请求/响应 JSON；错误统一 `{ error: string }`（中文）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务 + 引擎状态 |
| GET | `/api/bootstrap` | 配置、进度、引擎状态、等级表（前端启动一次拉全） |
| PUT | `/api/config` | 深合并配置（UI 项即时保存） |
| POST | `/api/engine/probe` | 探测硬件并推荐后端 |
| POST | `/api/engine/check` | 五步自检：程序/后端/主模型/human 模型/可行性 |
| POST | `/api/engine/restart` | 重启引擎 |
| POST | `/api/game` | 开局：`{mode, size?, level?, playerColor?, komi?}` |
| GET | `/api/matches` | 最近对局列表 |
| GET | `/api/game/:id` | 对局快照 |
| POST | `/api/game/:id/move` | `{vertex}` |
| POST | `/api/game/:id/pass` | 停一手（无 body） |
| POST | `/api/game/:id/undo` | `{toPly?}`；ranked 拒绝 |
| POST | `/api/game/:id/end` | 双方停手 → scoring；**ranked 拒绝**（防止挑时机收官） |
| POST | `/api/game/:id/resign` | 认输 |
| POST | `/api/game/:id/quit` | 中途退出（ranked 算负） |
| POST | `/api/game/:id/score` | `{dead: number[]}` 预览数子 |
| POST | `/api/game/:id/finish` | `{dead}` 确认结算（ranked 写进度） |
| POST | `/api/game/:id/analyze` | `{depth?}`（quick/standard/deep = 5/6/8 候选，180~4200 ms）→ 候选 + ownership；未配置引擎返回 `available:false` + 原因 |
| GET | `/api/game/:id/sgf` | 导出 SGF 文本 |
| POST | `/api/sgf/import` | `{text}` → 新对局（按 `PL` 还原先后手） |
| GET | `/api/progress` | 进度摘要 |
| POST | `/api/progress/name` | 改名 |
| POST | `/api/progress/reset` | 重置（需确认串） |
| POST | `/api/simulate/ranked` | 评级沙盘：在存档副本上跑 N 盘，**不动存档** |

**空 body 约定**：无参 POST 可以不带 body；若带了 `content-type: application/json` 但 body 为空，服务端 contentTypeParser 会当 `{}`（曾经全员 500）。客户端 `api.req` 只在有 body 时才设 content-type。

---

## 11. 前端 `web`

| 关注点 | 事实 |
|---|---|
| 棋盘 | **自绘 SVG**，未用 `@sabaki/shudan`（旧库不维护、与主题系统打架）；`Board.tsx` 用 `ResizeObserver` 量父容器短边定边长 |
| 尺寸 | 根容器 `height:100dvh; overflow:hidden`，每层 `min-height:0`；`100cqh` 未声明 container 时无效（踩过） |
| 落子虚影 | `hoverMark: 'square'（默认）\| 'ghost'`；square = accent 实心块 0.72 + boardLine 细边，换主题也看得清 |
| 形势图 | ownership 叠色，黑深蓝 / 白暖橙，透明度上限 35%，按 F 切换 |
| 音效 | WebAudio 现场合成，零素材；3 音色 `jade/porcelain/wood`；提子音 ×1.14 并叠击；**按盘面增量触发**，悔棋不响 |
| 主题 | `skins.ts` 两套 token → CSS 变量挂在根节点；切换 5 秒内可撤销 |
| 调试直达 | `?view=free\|ranked\|lan\|settings\|menu` + `?theme=walnut\|youth`（不影响正常使用） |
| 模式分叉 | 一律读 `CAPS[mode]`；三模式共用一个 `GameView` |
| 移动端 | ≤640px 顶栏换行、按钮收窄、棋盘占上半屏；手机只给下棋/看谱（不给分析） |

---

## 12. 主题系统

**原则**：主题只做两件事——改 Token、从预置组件家族里挑变体。**不重写界面**，否则每加一个功能就要乘 N 套主题验收。

| Token 组 | 内容 |
|---|---|
| `color` | bg / surface / surfaceAlt / primary / accent / text / textDim / line / board / boardEdge / boardLine / blackStone / whiteStone / seal / sealText / danger / ok |
| `radius` | sm / md / lg |
| `shadow` | 0~3 级 |
| `density` | comfortable / compact |
| `motion` | speed(ms) / bounce(bool) |
| `font` | title / body |
| `decor` | `[]` / `["glow"]`（性能不达标时自动关） |
| `playerMark` | `seal`（内置两套都用它；`avatarCard` 预留） |

允许：自定义属性、过渡、滤镜、伪元素、背景图。
禁止：`@import`、任何远程 URL、JS。schema 不认识的字段**忽略不报错**（旧版软件打开新主题不崩）。

两套内置：

| 主题 | 气质 | 关键差异 |
|---|---|---|
| **胡桃木**（默认） | 米白宣纸 + 深胡桃木 + 细金线 | 宋体标题、2~6px 直角、无阴影、无装饰、200ms、印章 |
| **星弈·青** | 墨青夜 + 金线 + 紫光 | 黑体、12~24px 大圆角、柔光、glow 装饰层、320ms 弹性、印章 |

未做：主题预览卡片（实时渲染微型界面）、zip 导入导出、`style.css` 白名单加载。

---

## 13. 数据文件

| 文件 | 入库 | 内容 |
|---|---|---|
| `data/config.json` | ✗ | 引擎路径/后端、UI 选项、游戏默认值、玩家名；见 `server/src/config.ts` |
| `data/ranks.json` | ✓ | 15 级校准分 + 锚点 + step/stepCi95 + 每级 sample/ci95；`calibrated` = 斜率已实测 |
| `progress.json` | ✗ | 当前级、R/RD、暂定、历史、连胜、保级/冷却、schemaVersion；写前 `.bak` |
| `progress.json.bak` | ✗ | 上一版存档（损坏时回退） |
| `data/games/*.sgf` | ✗ | 对局棋谱（导出/复盘） |
| `data/calibration/*.jsonl` | ✗ | 校准原始对局（每行一局） |
| `data/{tsumego,joseki,themes}/` | 目录占位 | 题库/定式/主题包（P4/P6） |
| `backups/progress-YYYYMMDD.json` | ✗ | 每日备份，留 10 份 |

`config.ui` 关键字段：`themeId` · `sound` · `soundPack` · `soundVolume` · `hoverMark` · `showOwnership` · `analysisDepth`(quick/standard/deep) · `playerColor`。
`config.game`：`maxLevel` · `komi` · `boardSize` · `aiResign`。

---

## 14. 里程碑与下一步

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 引擎跑通 + 分析流 + 规则引擎 + 15 级校准 | 完成；300 局实测，step=90（CI 50~131） |
| **P1** | 自在：摆棋分析 | 大半；缺自由摆子编辑、目差曲线、逐手跳转 |
| **P2** | 对 AI 下棋 + 复盘 | 对局与结算可用；缺逐手好/一般/失误标注、着法名、自动进复盘 |
| **P3** | 修习：评级全流程 | 流程可跑；等级表已实测；缺跳档考核 UI |
| **P4** | 教学 + 题库（≥1 套教学、≥100 题、10 题测级） | 未开始 |
| **P5** | 手谈：局域网联机（发现 + 房间码 + 观战 + 聊天） | 未开始 |
| **P6** | 主题：预览 + zip 导入导出 | 两套主题可用，其余未做 |
| **P7** | Electron 换壳 | 未开始 |
| **P8** | 开源发布：截图/GIF、CI、THIRD-PARTY 核验 | CI 与文档已有，其余待补 |

**建议顺序**（依赖关系决定）：P2 复盘标注（最贴"练棋"）→ P1 补齐摆子编辑/目差曲线 → P3 校准定死（40 盘/组）→ P5 联机 → P4 题库 → P6/P7。

**已知未收口的小事**：`THIRD-PARTY.md` 里 Sabaki 相关条目已过期（现在零 Sabaki 依赖，棋盘与 SGF 都自研），P8 前重写；`docs/题库规范.md`、`docs/联机协议.md` 未写。

---

## 15. 已踩过的坑（别再踩）

| # | 坑 | 正确做法 |
|---|---|---|
| K1 | 假引擎写成"乖"格式 → 测试全绿、真机全废 | 假对端必须照抄真实输出（含反例：`=` 紧跟 info、一行多段） |
| K2 | 手写自杀判定漏了"接上自己有外气的棋" | 合法性一律 `clone().place()` 看结果 |
| K3 | 只设 `humanSLProfile` → 1~11 级其实用主模型 | 必须同时 `humanSLChosenMoveProp=1` |
| K4 | `kata-analyze` 的 `=` 被当响应开头 → 零候选 | 分析模式吞掉 `=`/`?` |
| K5 | 一行一个候选的解析假设 → 零候选 | 按段切分，一行可能 5~6 段 |
| K6 | 无 body 的 POST 带 `content-type: application/json` → Fastify 400 | 客户端有 body 才设头；服务端空串当 `{}` |
| K7 | `.bat` 写成 LF → `goto` 解析失败，双击一闪退 | CRLF + `.gitattributes` 锁 `*.bat text eol=crlf` |
| K8 | CSS `100cqh` 没声明 container → 棋盘撑出窗口 | ResizeObserver 量容器短边 |
| K9 | `min-height:100%` + 侧栏变高 → 整页溢出、棋盘被切 | `height:100dvh; overflow:hidden` + 逐层 `min-height:0` |
| K10 | `size` 缺省值写成 `undefined` → 19 路变空盘 | `opts.size ?? 19` 后再校验；有回归测试 |
| K11 | `taskkill /F /IM node.exe` 杀掉用户所有 node 进程 | 按端口找 PID，`taskkill /PID <id> /T` |
| K12 | 数子面板做成全屏遮罩 → 棋盘盖住，没法点死子 | 面板放侧栏；点一颗子整块标死 |
| K13 | 校准脚本把未测级也写成默认值 → 整表被冲 | 只覆盖本次测过的级，其余沿用旧值 |
| K14 | 用历史累计提子数判断"响提子音" → 后半盘每手都响 | 比较前后快照增量 |
| K15 | 凭训练记忆写 GTP/引擎参数 | 先跑 `benchmark`、`kata-get-param` 验证，再落代码 |

---

## 16. 常见改动配方

### 16.1 加一个 API

1. `server/src/gameService.ts` 加业务方法（抛 `ServiceError(status, 中文)`）。
2. `server/src/api.ts` 注册路由；无参 POST 不要 body。
3. `web/src/api.ts` 加客户端方法（有 body 才设 `content-type`）。
4. `server/test/api.test.ts` 加 `app.inject` 用例（含错误分支）。

### 16.2 加一档音色 / 一个界面选项

1. `server/src/config.ts` 的 `AppConfig` 与 `DEFAULT_CONFIG` 同时加字段。
2. `web/src/types.ts` 的 `ui` 接口同步（它 re-export shared，但 config 类型在 web 里另有一份）。
3. `Settings.tsx` 加控件并 `api.saveConfig`。
4. 消费处读 `bootstrap.config.ui.*`；不要用 localStorage 另存一份（除主题的即时体验）。

### 16.3 改等级参数或评级阈值

1. 改 `packages/engine/src/params.ts`（档位）或 `packages/rating/src/glicko.ts` / `progress.ts`（阈值）。
2. 同步 `docs/评级说明.md` 与 §8 表。
3. 跑 `npm test`；再跑 `POST /api/simulate/ranked` 看升降手感（沙盘不动存档）。
4. 若动了 `data/ranks.json` 的步长/锚点，`calibrated` 必须保持 `false`，直到有 ≥6 样本/级。

### 16.4 验证界面（无头浏览器）

本机已验证可用的方式（Windows）：

- 截图脚本：`D:\workspace\test\xingyi-shots\shot.mjs`（CDP，支持 `--size 390x844`、`--eval` 执行点击/按键）
- 浏览器：`chrome-headless-shell` 在 `%LOCALAPPDATA%\ms-playwright\`；playwright CLI 版本与已装 build 可能不匹配
- 常用入口：`http://127.0.0.1:7388/?view=free&theme=youth`
- 判断标准：截图目检 + 控制台是否报错（脚本会打印 `页面无 JS 错误`）

### 16.5 提交

- 一个提交一件事；消息用 `feat(scope):` / `fix(scope):` / `docs:` / `chore:`。
- 提交前：`npm test` 全绿 + `npm run typecheck` 通过 + 本文件同步。
- 不提交 `data/config.json`、`data/engine/`、`data/models/`、`progress.json`。

---

## 17. 文档索引

| 文档 | 内容 |
|---|---|
| `README.md` | 给使用者的简介与快速开始 |
| `AGENTS.md` | 本文件：开发事实、契约、坑位 |
| `docs/引擎安装.md` | 三后端选择、本机实测安装记录、DLL 清单、benchmark、human SL 坑 |
| `docs/评级说明.md` | 公式、定级赛、升降级、防刷、A_k 怎么实测 |
| `docs/主题规范.md` | `theme.json` token/variants、CSS 白名单、包结构 |
| `docs/测试清单.md` | 手动回归清单（20+ 条勾选） |
| `docs/archive/PLAN-v2.5.md` | **历史设计稿，已弃用**。只用于查"当初为什么这么定"；与本文件冲突时以本文件为准 |
