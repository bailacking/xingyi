# 第三方依赖与素材

本文件记录项目使用的第三方代码、字体、音效与图像素材，以及各自许可证。
**新增任何依赖或素材前，先查许可证并在此登记。**

> 状态说明：`✅ 已核实` 表示已打开 LICENSE 文件确认；`⚠️ 待核实` 表示按公开资料填写，尚未逐文件确认。

## 运行依赖

| 名称 | 用途 | 许可证 | 状态 |
|---|---|---|---|
| [KataGo](https://github.com/lightvector/KataGo) | 围棋引擎，由星弈从官方发行页下载 | [KataGo 源码许可及第三方组件说明](https://github.com/lightvector/KataGo/blob/master/LICENSE) | 已核对官方来源 |
| [KataGo 神经网络权重](https://katagotraining.org/network_license/) | 主模型与 Human SL，从官方发行页下载 | 见官方模型许可与各发行页 | 已核对官方来源 |
| ~~Sabaki 生态（`@sabaki/shudan` / `@sabaki/sgf` / `@sabaki/go-board`）~~ | **当前未使用**：棋盘为自绘 SVG，SGF 解析与盘面逻辑均自研；仅早期设计参考过其思路 | — | 已移除依赖（2026-10-17） |
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

## 棋谱与教学数据

- 只用 **CC / 公有领域 / 自建** 内容
- 每份数据目录必须有 `SOURCES.md`，记录**逐条或逐批**的来源、许可证、采集日期
- 不收录来源不明的网络流传素材（尤其是仍在印刷发行的棋书内容）
- 围棋入门课的棋盘局面及文字为自建，规则参考[中国围棋协会《中国围棋规则》](https://wqwh.weiqi.org.cn/rules/)。
