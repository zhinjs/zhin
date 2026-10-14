---
title: "示例项目"
description: "仓库自带的可运行示例：从一个文件的 Bot 到带 AI 的完整项目，按想学的内容挑一个直接跑"
---

# 示例项目

看代码最快的方式是跑一个现成的例子。仓库的 `examples/` 目录下有一组由浅入深的官方示例，在仓库根目录 `pnpm install` 后都能直接运行。

| 示例 | 适合想看… | 启动命令 | 在哪里试 |
|------|------|------|------|
| [single-file-bot](#single-file-bot-一个-bot-ts-就是机器人) | 最短的 Bot 长什么样：只有一个 `bot.ts` | `pnpm --filter single-file-bot dev` | Console 的 Sandbox |
| [minimal-bot](#minimal-bot-约定目录的最小项目) | 按约定目录组织的最小项目，不含 AI | 仓库根 `pnpm dev` | 终端 |
| [capabilities-bot](#capabilities-bot-一个插件用到的常见能力) | 一个插件里怎么用配置、数据库、定时任务、工具 | `pnpm --filter capabilities-bot dev` | Console 的 Sandbox |
| [full-bot](#full-bot-带-ai-的完整参考) | 带 AI、语义记忆、MCP 的完整项目 | `pnpm dev:full` | Sandbox、NapCat、KOOK |
| [test-bot](#test-bot-维护者回归用) | 仅供维护者做多平台回归，不要当模板 | `pnpm dev:test` | 20+ 个平台 |

建议按 **single-file-bot → minimal-bot → capabilities-bot → full-bot** 的顺序看。

::: tip 只想创建自己的项目？
不用 clone 仓库，直接 `npm create zhin-app my-bot -y`，见 [快速开始](../getting-started/index.md)。
:::

## single-file-bot：一个 bot.ts 就是机器人

不建 `commands/` 等目录，直接在插件入口的 `setup({ addCommand })` 里注册命令。适合 demo、一次性脚本，或者向别人展示"启动有多短"。

```bash
pnpm --filter single-file-bot dev
```

打开 [Console](https://console.zhin.dev)，API Base 填 `http://127.0.0.1:8086`，在 Sandbox 里发送 **`/hello`**。

```text
single-file-bot/
├── bot.ts              # definePlugin + addCommand('hello')
├── package.json        # zhin.entry → ./bot.ts；plugins → sandbox
└── zhin.config.yml     # sandbox commandPrefix: '/'
```

用 `addCommand` 注册的命令和目录里发现的命令进同一个命令表，行为完全一样。功能变多后再拆成约定目录（见下面的 minimal-bot）。细节见该目录的 [README](https://github.com/zhinjs/zhin/tree/main/examples/single-file-bot)。

## minimal-bot：约定目录的最小项目

一个 `plugin.ts` 入口，加上 `adapters/`、`commands/`、`components/` 三个目录，直接在终端里对话。适配器、命令、组件这三类基础能力框架自带，`package.json#zhin` 里不用额外声明。

```bash
# 仓库根
pnpm install
pnpm dev            # = pnpm --filter minimal-bot dev
```

出现 `zhin> ` 提示符后，在同一终端输入 `/hello`，或 `/card` 看一张渲染出的状态卡片图。修改目录里的文件会自动热重载，`Ctrl+C` 退出。

```text
minimal-bot/
├── plugin.ts                 # definePlugin() 入口
├── schema.json               # 配置项定义
├── zhin.config.yml           # 配置
├── adapters/terminal/index.ts      # 终端适配器：stdin/stdout
├── commands/hello/index.ts         # /hello
├── commands/card/index.ts          # /card → 渲染组件
└── components/status-card/index.ts # 状态卡片组件
```

::: details Node.js 版本
要求 Node.js ≥22.6。22.6–22.17 由 CLI 自动加 `--experimental-strip-types` 运行 TypeScript，22.18 起原生支持。
:::

## capabilities-bot：一个插件用到的常见能力

**一个插件 + 一个 `zhin.config.yml`** 就能启动。它在一个 `setup()` 里演示了常用能力：读配置、建数据库表、定时任务、Agent 工具（没装 AI 时自动跳过）、主动发消息、停用时清理资源、在 Console 插件页显示卡片，以及挂载 npm 包形式的子插件（`@zhin.js/adapter-sandbox`）。

```bash
cd examples/capabilities-bot
pnpm dev            # zhin runtime start
```

启动后：

- Console 地址 `http://127.0.0.1:18099`，token 是 `capabilities-dev-token`，插件页能看到 `Capabilities Bot` 卡片；
- 可用命令 `whoami` 和 `stats`（后者演示数据库计数）；
- 心跳任务每 5 分钟打一行日志。

每项能力对应哪段代码，见该目录的 `README.md`。

## full-bot：带 AI 的完整参考

在约定目录项目上加了完整的 AI 能力：`@zhin.js/agent`、语义记忆、MCP、A2A 多 Agent 互联，以及 Sandbox、NapCat、KOOK 三个平台和 Skill / Tool / Page 等扩展。

```bash
# 先在仓库根完成 pnpm install && pnpm build
cd examples/full-bot
cp .env.example .env    # 填入模型服务的 Key 和 HTTP_TOKEN
pnpm dev                # 或在仓库根 pnpm dev:full
```

- Host 默认地址 `http://127.0.0.1:8069`，Console 的 Token 填 `.env` 中的 `HTTP_TOKEN`；
- 验收清单和 NapCat / KOOK 实机步骤见该目录的 `ACCEPTANCE.md`。

## test-bot：维护者回归用

::: warning 这不是入门模板
不要复制它作为新项目的起点。新项目请用 `npm create zhin-app`、[single-file-bot](#single-file-bot-一个-bot-ts-就是机器人) 或 [minimal-bot](#minimal-bot-约定目录的最小项目)。
:::

它挂载了 20 多个平台适配器（Sandbox、ICQQ×5、QQ 官方、Slack、Discord、Telegram、KOOK、钉钉、飞书、企业微信、LINE、Email、GitHub……）和全部功能插件（游戏中心、lottery、group-suite、rss、code-runner 等），用于维护者做多平台回归测试。

```bash
pnpm install && pnpm build   # 仓库根
pnpm dev:test                # 或 cd examples/test-bot && pnpm dev
```

- 要求 Node.js ≥22.18，凭据读该目录的 `.env`（模板见 `.env.example`）；
- Console 的 API Base 填 `http://127.0.0.1:8086`，Token 填 `test-bot-dev-token`；
- 后台运行：`pnpm daemon`（即 `zhin runtime start --daemon`），`pnpm stop` 停止。

## 下一步

- [快速开始](../getting-started/index.md)：用脚手架创建你自己的项目
- [编写第一个插件](../getting-started/first-plugin.md)：从零写一个可配置的命令
- [真实部署案例](../showcase/README.md)：看别人怎么在生产中使用 Zhin
