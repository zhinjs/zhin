<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>用 TypeScript 写一次聊天机器人，同时跑在 20+ 平台</strong><br />
  QQ · 微信 · 企业微信 · 钉钉 · 飞书 · Discord · Telegram · Slack · KOOK · LINE · …
</p>

<p align="center">
  <a href="https://github.com/zhinjs/zhin/actions/workflows/ci.yml"><img src="https://github.com/zhinjs/zhin/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/zhin.js"><img src="https://img.shields.io/npm/v/zhin.js.svg?color=cb3837" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/zhin.js"><img src="https://img.shields.io/npm/dm/zhin.js.svg?color=cb3837" alt="npm downloads" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/zhin.js.svg?color=339933" alt="Node" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://codecov.io/gh/zhinjs/zhin"><img src="https://codecov.io/gh/zhinjs/zhin/graph/badge.svg" alt="codecov" /></a>
  <a href="https://zhin.js.org"><img src="https://img.shields.io/badge/docs-zhin.js.org-0ea5e9" alt="Docs" /></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <b>简体中文</b>
</p>

<p align="center">
  <a href="https://zhin.js.org">文档</a> ·
  <a href="https://demo.zhin.dev">在线 Demo</a> ·
  <a href="https://console.zhin.dev">Remote Console</a> ·
  <a href="https://github.com/zhinjs/zhin/wiki">Wiki</a> ·
  <a href="./docs/contributing/development.md">贡献指南</a>
</p>

---

## Zhin.js 是什么？

Zhin.js 是一个**开发聊天平台机器人**的框架——社区群 Bot、个人助手、通知 / 客服 Bot、AI 对话助手都可以用它来写。

- **一套代码，多个平台。** 适配器把各平台的消息统一成一种格式，你的命令和回复到处都能用。一个 Bot 还能同时登录多个平台的多个账号。
- **写功能 = 放一个文件。** `commands/hello/index.ts` 就是 `/hello` 命令。中间件、消息卡片、定时任务、AI 工具同理，不需要手写注册代码。
- **默认很小，需要时再加 AI。** IM 核心不到 10MB，开发测试不需要模型 Key；一条命令即可接入大模型、工具、记忆和 MCP。
- **热重载不会把 Bot 弄挂。** 保存文件就生效；新代码出错时，旧版本继续服务。
- **在浏览器里管理。** 打开 [console.zhin.dev](https://console.zhin.dev) 就能发测试消息、看日志、改配置、管插件，无需部署前端。

> Zhin **不是** Cursor / Claude Code 那类写代码的 Agent。它的 AI 能力服务于聊天平台里的机器人。

## 快速开始

不需要任何平台账号，也不需要模型 Key。

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

1. 打开 [console.zhin.dev](https://console.zhin.dev)。
2. 填入终端打印的 API 地址（新项目默认 `http://127.0.0.1:8068`）和 `.env` 里的 `HTTP_TOKEN`。
3. 打开 **Sandbox** 会话，发送 `/hello`，收到回复即成功。

`-y` 表示全部使用默认选项：用浏览器里的 **Sandbox**（模拟聊天窗口）代替真实平台，不启用 AI。环境要求：Node.js **≥22.19.0** 与 pnpm 9+。遇到问题先运行 `npx zhin doctor`。

完整步骤：[快速开始](./docs/getting-started/index.md) · 暂时不想安装？试试 [在线 Demo](https://demo.zhin.dev)。

> [!IMPORTANT]
> **从 1.1.13 及更早版本升级已有 Bot？** Runtime 现在只接受 `configVersion: 2`。先停止 Bot，把 `zhin.js` / `@zhin.js/cli` 升级到最新，再运行 `zhin migrate instances`（预览）和 `zhin migrate instances --apply`（自动备份）。完整步骤与恢复方式：[升级到 configVersion 2](./docs/operations/upgrades.md#configversion-2)。

## 一个 Bot 由什么组成

```text
 聊天平台            你的项目（一个插件）                              聊天平台
 QQ / Discord … ──▶ 适配器 ──▶ 中间件 ──▶ 命令 ─────────────────────▶ 适配器 ──▶ 回复
                                          │ 没有匹配到命令
                                          └──▶ AI Agent（可选）──▶ 工具
```

| 组成部分 | 是什么 | 写在哪里 |
|----------|--------|----------|
| **插件** | 你的项目本身就是一个插件；功能多了可以拆成多个子插件 | `plugin.ts` + `package.json` 里的 `zhin` 字段 |
| **命令** | 用户发送 `/hello` 时执行 | `commands/hello/index.ts` |
| **中间件** | 每条消息都会经过——关键词回复、过滤 | `middlewares/<name>/index.ts` |
| **适配器** | 接入某个平台的 npm 包；一个适配器可挂多个账号 | `@zhin.js/adapter-*`，在 `zhin.config.yml` 中配置 |
| **AI Agent**（可选） | 回答没匹配到命令的消息，并能调用你写的工具 | `tools/<name>/index.ts`，`zhin.config.yml` 的 `ai:` 段 |
| **Console** | 浏览器管理后台：日志、配置、测试消息 | [console.zhin.dev](https://console.zhin.dev) |

文档里的名词看不懂？读 [核心概念速览](./docs/getting-started/concepts.md)，每个词都有大白话解释。

## 编写功能

整个 Bot 可以只有一个文件：

```ts
// bot.ts
import { definePlugin } from 'zhin.js'
import { defineCommand } from 'zhin.js/command'

export default definePlugin({
  name: 'my-bot',
  setup({ addCommand }) {
    addCommand('hello', defineCommand({
      description: '打招呼',
      execute: () => 'Hello from Zhin!',
    }))
  },
})
```

功能变多后，把每个能力放进单独的文件。目录路径就是名字，文件会自动注册：

```ts
// commands/remind/index.ts  →  /remind 10 喝水
import { defineCommand } from 'zhin.js/command'

export default defineCommand({
  description: '创建提醒',
  params: {
    minutes: { type: 'integer', min: 1, max: 1440 },
    note: { type: 'text', default: '休息一下' },
  },
  options: { quiet: { type: 'boolean', default: false } },   // --quiet
  execute: ({ params, options }) =>
    options.quiet ? '好的' : `好的，${params.minutes} 分钟后提醒你：${params.note}`,
})
```

```text
my-bot/
├── package.json      # zhin 字段：入口、子插件（装了什么）
├── zhin.config.yml   # 端口、平台凭据、模型（怎么配）
├── .env              # 密钥：HTTP_TOKEN、API Key
├── plugin.ts         # 入口：definePlugin()
├── commands/         # 命令——目录路径即命令名
├── middlewares/      # 每条消息都会经过
├── components/       # 可复用的 JSX 消息卡片
├── schedules/        # 定时任务
├── tools/            # 给 AI 调用的函数（可选）
└── pages/            # 自定义 Console 页面
```

下一步：[编写第一个插件](./docs/getting-started/first-plugin.md) · [全部约定目录](./docs/authoring/conventions.md) · [命令详解](./docs/authoring/commands.md)

## 接入真实平台

```bash
npx zhin setup --adapters   # 选择平台、填写凭据
pnpm install && pnpm dev
```

| 平台 | 包名 | 平台 | 包名 |
|------|------|------|------|
| Sandbox（本地测试） | `@zhin.js/adapter-sandbox` | QQ（ICQQ） | `@zhin.js/adapter-icqq` |
| QQ 官方机器人 | `@zhin.js/adapter-qq` | OneBot v11 / v12 | `@zhin.js/adapter-onebot11` / `onebot12` |
| Discord | `@zhin.js/adapter-discord` | Telegram | `@zhin.js/adapter-telegram` |
| Slack | `@zhin.js/adapter-slack` | KOOK | `@zhin.js/adapter-kook` |
| 钉钉 | `@zhin.js/adapter-dingtalk` | 飞书 | `@zhin.js/adapter-lark` |
| 企业微信 | `@zhin.js/adapter-wecom` | 微信公众号 | `@zhin.js/adapter-wechat-mp` |
| LINE | `@zhin.js/adapter-line` | NapCat / Milky / Satori | `napcat` / `milky` / `satori` |
| Email | `@zhin.js/adapter-email` | GitHub | `@zhin.js/adapter-github` |

每个适配器都标注了成熟度（Stable / Advanced / Experimental）并有独立接入文档：[平台适配器概览](./docs/adapters/index.md)。

## 接入 AI（可选）

```bash
npx zhin setup --ai   # 选择模型服务（OpenAI、Ollama…）并写入配置
pnpm install && pnpm dev
```

向导会安装 Agent 运行时与工具 / Prompt 相关 Feature，并在 `zhin.config.yml` 写入类似配置（密钥写入 `.env`）：

```yaml
ai:
  enabled: true
  providers:
    openai-main:
      sdk: openai
      apiKey: ${AI_API_KEY}
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o-mini
```

之后，没匹配到命令的消息会交给模型回答——私聊默认触发，群里用 `ai:` 前缀或 @ 触发。往 `tools/` 里加文件即可赋予它新能力；权限、审批、文件与网络访问由框架策略控制，而不是靠提示词。

下一步：[AI 总览](./docs/ai/index.md) · [Agent 工具、Skill 与 Prompt Section](./docs/authoring/agent-tools.md) · [AI Agent 学习路径](./docs/paths/ai-agent.md)

## 按需安装

默认只装 IM 核心；AI、模型 SDK、MCP、图片渲染、语音都是可选包。启用 AI 时推荐使用 `npx zhin setup --ai`，它会一并写好依赖与 Feature 声明。

### Install tiers（zhin.js 1.1.x）

| 档位 | 安装 | 约 production 体积 | 能力 |
|------|------|-------------------|------|
| **IM** | `pnpm add zhin.js` + 适配器（如 `@zhin.js/adapter-sandbox`）；dev：`@zhin.js/cli` | **<10MB**（库包） | Plugin Runtime、命令/组件/适配器约定目录（Stable Features 由 `@zhin.js/core` 的 `zhin.features` 继承；Host 为 optional peer + `zhin.plugins`，见 [插件模型](/concepts/plugin-model)） |
| **AI** | `+ @zhin.js/agent zod ai` | +~12–15MB | ZhinAgent、会话、工具、压缩 |
| **Provider** | `+ @ai-sdk/openai` 等 | 按厂商 | 大模型调用 |
| **MCP** | `+ @modelcontextprotocol/sdk` | +~数 MB | MCP Client |
| **Rich media** | `+ @zhin.js/html-renderer` | 按平台（含原生引擎） | 出站 `html` / `markdown` 转 PNG（未装则降级 text） |
| **Speech** | `+ @zhin.js/speech` | +~数 MB | 入站 STT、出站 TTS、`segment.tts`（未装则 warn 降级） |

1.1 起，`ZhinAgent` / `AIService` 需从 `zhin.js/agent` / `zhin.js/ai` 导入，不再从 `zhin.js` 导出。表格来源：[`docs/snippets/install-tiers.md`](./docs/snippets/install-tiers.md)。

## 文档导航

| 我想…… | 从这里开始 |
|--------|------------|
| 了解 Zhin 是什么 | [Zhin.js 是什么](./docs/getting-started/introduction.md) · [核心概念速览](./docs/getting-started/concepts.md) |
| 第一次跑起 Bot | [快速开始](./docs/getting-started/index.md) · [示例项目](./docs/examples/index.md) |
| 写插件 | [第一个插件](./docs/getting-started/first-plugin.md) · [definePlugin 全景](./docs/authoring/define-plugin.md) · [插件完整交付（测试与发布）](./docs/authoring/plugin-delivery.md) |
| 接入平台 | [平台适配器](./docs/adapters/index.md) · [配置参考](./docs/configuration/index.md) |
| 设置语言 | [项目、个人与 Console 语言](./docs/configuration/localization.md) |
| 加 AI | [AI 总览](./docs/ai/index.md) · [Agent 深入](./docs/ai/agent.md) |
| 部署运维 | [部署与恢复](./docs/operations/production.md) · [Console](./docs/console/index.md) · [故障排查](./docs/troubleshooting/index.md) |
| 理解内部原理 | [分层架构](./docs/concepts/architecture.md) · [插件模型](./docs/concepts/plugin-model.md) · [消息流](./docs/concepts/message-flow.md) · [热重载（Generation）](./docs/concepts/generation-lifecycle.md) |

文档站：[zhin.js.org](https://zhin.js.org)（导航栏可切换英文）。

## CLI 速查

```bash
npx zhin setup            # 给已有项目补充平台、AI、数据库
npx zhin doctor           # 诊断 Node、端口、Token、清单
npx @zhin.js/cli new my-plugin --standalone  # 创建可发布的独立插件包
npx zhin search <关键词>   # 搜索社区插件
npx zhin install <插件名>  # 安装并挂载插件
```

全部命令：[CLI 参考](./docs/cli/index.md)。

## 包一览

| 包 | 作用 |
|----|------|
| [`zhin.js`](./packages/im/zhin) | 你要安装的主包——插件作者需要的 API 都从这里导入 |
| [`create-zhin-app`](./packages/toolkit/create-zhin) | 项目脚手架（`npm create zhin-app`） |
| [`@zhin.js/cli`](./basic/cli) | `zhin` 命令：启动、配置、诊断、发布 |
| [`@zhin.js/agent`](./packages/im/agent) | 可选的 AI Agent 运行时，含安全策略 |
| [`@zhin.js/adapter-*`](./plugins/adapters) | 各平台适配器 |
| [`plugins/`](./plugins) | 官方插件：小游戏、提醒、RSS、日历、内容审核…… |

各层如何组合：[分层架构](./docs/concepts/architecture.md) · [仓库结构](./docs/contributing/repo-structure.md)。

## 参与贡献

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install && pnpm build
pnpm dev                  # 运行 examples/minimal-bot
```

其他入口：`pnpm --filter single-file-bot dev`（单文件 Bot）、`pnpm dev:test`（维护者用的全功能 `test-bot`，不是用户模板）。检查项、代码约定和发布流程见 [贡献指南](./docs/contributing/development.md)。

<p align="center">
  <a href="https://github.com/zhinjs/zhin/graphs/contributors">
    <img src="https://contributors-img.web.app/image?repo=zhinjs/zhin" alt="Contributors" />
  </a>
</p>

<p align="center">
  <img src="https://repobeats.axiom.co/api/embed/26e79889b3756142f3145cd72ae19830e6b4c06a.svg" alt="Repobeats" />
</p>

## License

[MIT](./LICENSE)
