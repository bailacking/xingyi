# 第三方依赖与素材

本文件记录项目使用的第三方代码、字体、音效与图像素材，以及各自许可证。
**新增任何依赖或素材前，先查许可证并在此登记。**

> 状态说明：`✅ 已核实` 表示已打开 LICENSE 文件确认；`⚠️ 待核实` 表示按公开资料填写，尚未逐文件确认。

## 运行依赖

| 名称 | 用途 | 许可证 | 状态 |
|---|---|---|---|
| [KataGo](https://github.com/lightvector/KataGo) | 围棋引擎（用户自行安装，不随仓库分发） | MIT | ⚠️ 待核实 |
| KataGo 神经网络权重 | AI 模型（用户自行下载，不随仓库分发） | 以官方发布页说明为准 | ⚠️ 待核实 |
| [Sabaki](https://github.com/SabakiHQ/Sabaki) 生态：`@sabaki/shudan` / `@sabaki/sgf` / `@sabaki/go-board` / `@sabaki/immutable-gametree` | 棋盘渲染、棋谱解析、盘面逻辑、变体树 | MIT（记得如此） | ⚠️ 待核实 |
| [Fastify](https://github.com/fastify/fastify) | HTTP 服务 | MIT | ⚠️ 待核实 |
| [ws](https://github.com/websockets/ws) | WebSocket（联机） | MIT | ⚠️ 待核实 |
| [React](https://github.com/facebook/react) | 前端框架 | MIT | ⚠️ 待核实 |
| [Vite](https://github.com/vitejs/vite) | 构建工具 | MIT | ⚠️ 待核实 |
| [Vitest](https://github.com/vitest-dev/vitest) | 测试 | MIT | ⚠️ 待核实 |

## 字体

| 名称 | 用途 | 许可证 | 状态 |
|---|---|---|---|
| 思源宋体 Source Han Serif | 标题 / 印章 | SIL Open Font License 1.1 | ⚠️ 待核实 |
| 思源黑体 Source Han Sans | 正文 / UI | SIL Open Font License 1.1 | ⚠️ 待核实 |

## 素材

全部素材必须为 **CC0 / 公有领域**，逐项登记来源 URL 与获取日期。

| 名称 | 类型 | 来源 URL | 许可证 | 获取日期 |
|---|---|---|---|---|
| _（待补）_ | 落子 / 提子 / 磬声 | | CC0 | |
| _（待补）_ | 木纹贴图 | | CC0 | |

## 题库与棋谱

标准见 `docs/题库规范.md`。要求：

- 只用 **CC / 公有领域 / 自建** 内容
- 每个题库目录必须有 `SOURCES.md`，记录**逐题或逐批**的来源、许可证、采集日期
- 不收录来源不明的网络流传题库（尤其是仍在印刷发行的棋书内容）
