# 星弈 · xingyi

> 跑在自己电脑上的围棋软件。KataGo 当对手和老师，三种模式三套规则，界面可换。

![status](https://img.shields.io/badge/status-playable-green)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%E2%89%A520-informational)

---

## 现在能做什么

| 模式 | 一句话 | 状态 |
|---|---|---|
| **自在** | 9/13/19 路随便下：悔棋、停一手、认输、终局数子、SGF 导入导出、候选点与形势图 | 可玩 |
| **修习** | 3 盘定级 → 15 级成长线 → 升降级，每盘计入进度（**需先装引擎**） | 可玩，等级表已实测 |
| **手谈** | 局域网对战：自动发现 + 房间码 + 观战 + 聊天 | 未开始 |

两套主题（胡桃木 / 星弈·青）、印章式玩家标识、手机浏览器直接下。

**没装引擎也能玩**：自在模式会退化成程序自带的离线对手，规则与棋盘都是真的，一样能下完并数目判胜负。修习模式则必须先有引擎——等级是拿引擎校准出来的，没引擎算不了。

还没做：手谈联机、教学与题库、主题包 zip 导入导出、Electron 换壳。详见 [路线图](#路线图)。

## 快速开始

```bash
git clone https://github.com/bailacking/xingyi.git
cd xingyi
npm install
npm run dev        # 服务 7388 + 前端 5173
```

打开 **http://localhost:5173** 。生产模式：

```bash
npm run build && npm start   # 只跑 7388，前端由服务托管
```

Windows 用户可直接双击 **`start.bat`**（开发模式）或 `start.bat prod`（生产模式）：自动查 Node、缺依赖就装、缺构建就构建、延迟几秒开浏览器，关窗口即停。

## 引擎要自己装

仓库**不内置** KataGo 与权重（体积和许可证都不适合入库）。设置页有三步向导，每一栏当场校验并给中文原因：

1. 选后端（探测显卡，推荐 CUDA / OpenCL / Eigen）
2. 指定 `katago` 程序
3. 指定主模型与 human SL 模型

完整步骤、DLL 依赖与本机实测数据见 **[docs/引擎安装.md](docs/引擎安装.md)**。

> 参考实测（RTX 3050 Ti Laptop 4 GB）：双模型可同进程加载，显存 985 MB，约 540 visits/s。

## 项目结构

```
packages/   共享类型 · 规则引擎 · 评级 · 引擎客户端（前后端共用）
server/     Fastify REST + WS：对局、SGF、结算、进度
web/        React 前端：SVG 棋盘、对局界面、设置、双主题
data/       ranks.json（入库）；引擎/模型/配置/棋谱（不入库）
docs/       引擎安装 · 评级说明 · 主题规范 · 测试清单
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 服务 + 前端一起跑 |
| `npm test` | 全部单测（71 项） |
| `npm run typecheck` | 全量类型检查 |
| `npm run build` | 构建 packages + server + web |
| `npm start` | 只跑生产服务（7388） |

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 引擎跑通 + 分析流 + 规则引擎 | 完成（15 级实测，90 分/级） |
| P1 | 自在·摆棋分析 | 对弈/分析/SGF 可用；摆子编辑、目差曲线待做 |
| P2 | 对 AI 下棋 + 复盘 | 对局与结算可用；逐手失误标注待做 |
| P3 | 修习·升级模式 | 流程可跑，等级表已实测 |
| P4 | 教学 + 题库 | 未开始 |
| P5 | 手谈·局域网联机 | 未开始 |
| P6 | 主题系统（预览 + 导入导出） | 两套内置主题可用 |
| P7 | Electron 换壳 | 未开始 |
| P8 | 开源发布 | CI 与文档已有 |

## 开发

- **[AGENTS.md](AGENTS.md)** —— 开发手册：当前状态、不变量、API、引擎参数、踩过的坑。改代码前先读它。
- [docs/](docs/README.md) —— 引擎安装 / 评级说明 / 主题规范 / 测试清单
- [docs/archive/PLAN-v2.5.md](docs/archive/PLAN-v2.5.md) —— 早期设计稿，**已弃用归档**，只作考古

## 许可与致谢

[MIT](LICENSE) · 第三方依赖与素材登记在 [THIRD-PARTY.md](THIRD-PARTY.md)。

感谢 [KataGo](https://github.com/lightvector/KataGo)（MIT）、[思源宋体 / 思源黑体](https://github.com/adobe-fonts)（SIL OFL）。
