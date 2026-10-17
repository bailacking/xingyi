# 星弈 · xingyi

> 一个跑在自己电脑上的围棋修炼软件。KataGo 做对手与老师，三种模式各有一套规则，界面从典雅木盘到深青夜色，都可以换。

![status](https://img.shields.io/badge/status-P1%20%E5%8F%AF%E8%B7%91-green)
![license](https://img.shields.io/badge/license-MIT-blue)

**简体中文** | [设计文档](PLAN.md)

---

## ⚠️ 项目状态

**已可运行（P0 完成 / P1 进行中）。** 现在能做的事：

- **自在**：9/13/19 路随便下，悔棋、停一手、认输、导入导出 SGF、形势图
- **修习**：定级赛 → 15 级成长线 → 升降级结算（**需要先装 KataGo**）
- 双主题（胡桃木 / 星弈·青）、印章式玩家标识、AI 或离线对手

还没做：手谈（联机）、教学题库、Electron 换壳。进度见 [路线图](#路线图)。

**没有显卡也能跑起来看界面**：没配置引擎时「自在」模式会用程序自带的**离线对手**（启发式陪练，不是 KataGo），棋盘与规则都是真的。

---

## 这是什么

市面上的围棋软件大多面向"已经会下棋的人"：满屏胜率百分比、变化图、几十个参数滑杆。初学者打开它，看到的是一个专业仪表盘。

星弈反过来做三件事：

1. **把"练"变成主线**——有升级模式（15 级成长线）、自由模式（随便试）、联机模式（真人对抗）
2. **说人话**——不给你 23% 胜率，给你"你落后 12 目，左下角死了"
3. **界面值得久坐**——默认是胡桃木与思源宋体，也能换成深青夜色的年轻风格

对手与老师都是本机运行的 **KataGo**（当前最强的开源围棋引擎），不联网也能用。

---

## 功能

| 模块 | 内容 | 状态 |
|---|---|---|
| **修习**（升级模式） | 15 级成长线，Glicko 式评分升降级，3 盘自适应定级，跳档考核 | 可玩（需引擎） |
| **自在**（自由模式） | 自由对弈 + 实时推荐 + 形势图；导入导出 SGF | 可玩 |
| **手谈**（联机模式） | 局域网对战，电脑与手机浏览器可加入，自动发现 + 房间码，观战与聊天 | 未开始（P5） |
| 教学 | 规则交互式跟做、定式练习、死活题库、10 题测级 | 未开始（P4） |
| 主题 | Token + 组件变体的深度主题系统，导入导出 zip，禁 JS | 两套内置主题可用，导入导出未做（P6） |

### 三种模式的差异

不是难度设置，是三套规则世界（灵感来自 Minecraft 的生存 / 创造）：

| | 修习 | 自在 | 手谈 |
|---|---|---|---|
| 胜率 / 点评 | 强制隐藏 | 开关 | 开关 |
| 悔棋 | 禁止 | 开关 | 需对方同意 |
| 摆棋分析 | 不可用 | 可用 | 不可用 |
| 进度 | 计入 | 不计 | 不计 |

### 主题

| 主题 | 气质 |
|---|---|
| **胡桃木**（默认） | 米白底、深胡桃木、细金线；宋体、直角、无动效；印章式玩家标识 |
| **星弈·青** | 墨青夜色；黑体、大圆角、柔光、装饰层、弹性动效 |

主题包 = `theme.json`（tokens + variants）+ 可选 `style.css` + 素材。**不允许 JS**，不允许远程 URL。

---

## 架构

```
浏览器（Vite + React + TS）
  棋盘 / 三模式界面 / 主题系统 / 手机端精简视图
        │  REST + WebSocket
Node 服务（TypeScript）
  engine/  GTP 封装·分析流·进程守护·后端探测
  rules/   提子·劫·superko·数子
  rating/  评级·定级赛·晋级判定·存档
  api/     REST + WS
  store/   SGF·题库·主题·配置
  room/    联机房间（房主权威）
        │  stdin/stdout（GTP）
katago.exe（CUDA / OpenCL / Eigen）+ 主模型 + human SL 模型
```

- **开发形态**：先做「本地 Node 服务 + 浏览器前端」，稳定后用 Electron 换壳（前端代码零改动）
- **单引擎进程**，请求串行化；对弈与实时分析共用，思考期间不出提示

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite · React · TypeScript |
| 棋盘 | `@sabaki/shudan`（起步） |
| 后端 | Node 22 · Fastify · `ws` |
| 规则 / 评级 | 自研（`@sabaki/go-board` 不管 superko、数子、死子） |
| 测试 | Vitest |
| 打包 | electron-builder（后期） |

---

## 快速开始

```bash
git clone https://github.com/bailacking/xingyi.git
cd xingyi
npm install          # 用 npm workspaces（不需要 pnpm）
npm run build:packages
npm run dev          # 同时起 Node 服务（7388）与前端（5173）
```

打开 <http://localhost:5173> 。生产模式一次构建即可：

```bash
npm run build && npm start   # 打开 http://127.0.0.1:7388
```

> 为什么用 npm 而不是 pnpm：planner 里写的是 pnpm，但「别人必须能跑起来」这条硬约束优先——
> npm 随 Node 自带，少一步安装。workspaces 能力等价。

### 引擎需要自己装

星弈**不内置** KataGo 与权重（体积与许可证都不适合塞进仓库）。首次运行走三步向导（设置页）：

1. 选后端（程序探测显卡并推荐 CUDA / OpenCL / Eigen）
2. 指定 `katago` 程序
3. 指定主模型与 human SL 模型

每一栏都当场校验，失败给中文原因。安装说明见 **[docs/引擎安装.md](docs/引擎安装.md)**。

---

## 目录结构

```
packages/
  shared/       共享类型、模式能力表（CAPS）、坐标换算
  rules/        中国规则：提子 / 劫 / positional superko / 数子
  rating/       Glicko 式评分 / 定级赛 / 升降级 / 存档备份
  engine/       GTP 串行客户端 / kata-analyze 流 / 后端探测 / 离线对手
server/         Fastify REST + WS：对局生命周期、SGF 存取、进度结算
web/            React 前端：棋盘、印章、面板、双主题
data/           引擎与模型（不入库）、ranks.json、题库、主题、存档
docs/           引擎安装 / 评级说明 / 主题规范
PLAN.md         完整设计文档（19 章 / 72 条决策）
```

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 服务 + 前端一起跑（5173） |
| `npm test` | 全部单测（规则 / 评级 / 引擎协议 / 服务端 API） |
| `npm run typecheck` | 全量类型检查 |
| `npm run build` | 构建 packages + server + web |
| `npm start` | 只跑生产服务（托管已构建前端） |

---

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 地基：引擎跑通 + 15 级校准 · GTP 客户端 + 分析流 · 规则引擎与单测 | 规则与 GTP 完成；**15 级校准分待实测** |
| **P1** | 自在·摆棋分析（含导入外部 SGF） | 对弈 / 悔棋 / 导入 SGF / 形势图 / 候选点可用；摆子编辑与目差曲线未做 |
| **P2** | 对 AI 下棋 + 复盘 | 对局与终局结算可用；逐手失误标注未做 |
| **P3** | 修习·升级模式（评级 / 定级赛 / 升降级 / 存档） | 流程可跑，参数待校准 |
| **P4** | 教学 + 题库 | 未开始 |
| **P5** | 手谈·局域网联机 | 未开始 |
| **P6** | 主题系统（胡桃木 + 星弈·青 + 导入导出） | 两套 Token 主题可用；zip 导入导出未做 |
| **P7** | Electron 换壳 | 未开始 |
| **P8** | 开源发布：README / CI / 文档齐全 | CI 与文档开始补 |

---

## 设计文档

所有设计与取舍记录在 [PLAN.md](PLAN.md)，包括：

- 为什么用 Glicko 式评分而不是"赢一盘升一级"
- 为什么低段 AI 必须用 human SL 模型（否则只会随机犯蠢）
- 为什么主题只做 Token + 组件变体，而不是允许重写界面
- 为什么索引走 UDP 广播、落子要以房主为准

---

## 许可证

[MIT](LICENSE)

## 致谢

- [KataGo](https://github.com/lightvector/KataGo) — 开源围棋引擎，MIT
- [Sabaki](https://github.com/SabakiHQ/Sabaki) 生态（shudan / sgf / go-board） — 棋盘与棋谱基础
- [思源宋体 / 思源黑体](https://github.com/adobe-fonts) — SIL OFL
- CC0 素材提供者（音效、木纹贴图），逐项记录在 [THIRD-PARTY.md](THIRD-PARTY.md)
