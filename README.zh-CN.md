<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>用 TypeScript 写一次，同时跑在 20+ 聊天平台</strong><br />
  文件即命令、跨平台 JSX 互动卡片、不断线热重载、按需 AI Agent —— 浏览器里一站管理<br />
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
  <a href="./docs/authoring/define-plugin.md">插件开发</a> ·
  <a href="./docs/customer/index.md">运营指南</a> ·
  <a href="https://demo.zhin.dev">在线 Demo</a> ·
  <a href="https://console.zhin.dev">Remote Console</a> ·
  <a href="./docs/contributing/development.md">贡献指南</a>
</p>

---

> **不写代码，只想管好群和 Bot？** 直接阅读 [运营与群管指南](./docs/customer/index.md) 或体验 [在线 Demo](https://demo.zhin.dev)。用 TypeScript 写命令、插件与 AI 工具？直接看下方快速开始或 [插件开发指南](./docs/authoring/define-plugin.md)。

## 30 秒快速开始

不需要任何平台账号，也不需要模型 Key（要求 Node.js **≥22.19.0** 与 pnpm 9+）：

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

1. **本地内置 Sandbox**：浏览器直接打开 `http://127.0.0.1:8068/sandbox`，发送 `/hello` 即可收到回复。
2. **Remote Console 管理台**：打开 [console.zhin.dev](https://console.zhin.dev)，填入 `http://127.0.0.1:8068` 和 `.env` 里的 `HTTP_TOKEN`，查看日志、管理插件与实时会话。

完整步骤：[快速开始](./docs/getting-started/index.md) · 遇到环境问题先运行 `npx zhin doctor`。

> [!IMPORTANT]
> **从 1.1.13 及更早版本升级已有 Bot？** Runtime 现在只接受 `configVersion: 2`。先停止 Bot，把 `zhin.js` / `@zhin.js/cli` 升级到最新，再运行 `zhin migrate instances`（预览）和 `zhin migrate instances --apply`（自动备份）。完整步骤与恢复方式：[升级到 configVersion 2](./docs/operations/upgrades.md#configversion-2)。

## 为什么选择 Zhin.js？

Zhin.js 是面向**聊天平台机器人**的 TypeScript 框架——社群运营 Bot、个人生活助手、客服与通知推送、带安全护栏的 AI 群助手都能用它构建。

- **一套代码，20+ 平台。** 适配器抹平平台协议差异，业务层只处理统一消息模型；一个 Bot 进程可同时挂载多个平台的多个账号。
- **写功能 = 放一个文件。** 把文件放进 `commands/`、`middlewares/`、`components/`、`schedules/`、`tools/` 即自动发现注册，零样板代码。
- **Generation 级无感热重载。** 保存文件即后台装配新 Generation 并原子切换；处理中的消息在旧代跑完，新代码出错时旧版本继续服务，绝不把 Bot 弄挂。
- **默认核心 <10MB，按需加装 AI。** 纯 IM 场景不装任何大模型依赖；随时用 `npx zhin setup --ai` 一键接入大模型、工具、三层 Markdown 记忆与 MCP。
- **浏览器管理后台与 Server-Driven Blueprints。** 在 [console.zhin.dev](https://console.zhin.dev) 查看账号状态、表单化改配置、回放 AI 决策、一键紧急止损。插件只需用纯 TypeScript 编写 `definePageBlueprint`（`pages/<name>/index.ts`——零 `.tsx`、零 `esbuild` 预打包），即可在 Web Console 统一渲染，并自动投影为跨平台 IM 卡片消息（`projectBlueprintToImCard`）或终端 CLI TUI 面板（`projectBlueprintToCliPanel`）。

> Zhin **不是** Cursor / Claude Code 那类代码编辑器里的编程 Agent。它的 AI 能力专为聊天平台、群聊权限和多用户交互设计。

## 三大核心体验（Show, Don't Tell）

### 1. 命令 + 跨平台 JSX 互动卡片与按钮

用 JSX 写一次互动卡片（`commands/poll/index.tsx`）。支持按钮的平台直接渲染原生按钮；不支持按钮的纯文本平台会自动降级为编号选项，用户回复数字即可触发同一个 `onClick` 回调：

```tsx
// commands/poll/index.tsx  →  /poll "今天发版吗？"
import { defineCommand } from 'zhin.js/command'

export default defineCommand({
  description: '发起一键投票',
  params: {
    topic: { type: 'text', default: '今天发版吗？' },
  },
  execute: ({ params }) => (
    <card title={`📊 ${params.topic}`}>
      <text>点击按钮投票（纯文本平台可直接回复对应序号）：</text>
      <button label="👍 赞成" onClick={(msg) => `已记录 ${msg.$sender.name} 投了 👍`} />
      <button label="🤔 再议" onClick={(msg) => `已记录 ${msg.$sender.name} 投了 🤔`} />
    </card>
  ),
})
```

### 2. 零样板 AI 工具（Schema + 权限护栏）

在 `tools/<name>/index.ts` 中用 `defineAgentTool` 和 `Schema.object(...)` 声明工具。哪些会话可见、是否需要人工审批，均由框架安全策略强制执行，不靠提示词自觉：

```ts
// tools/weather/index.ts
import { Schema } from 'zhin.js'
import { defineAgentTool } from '@zhin.js/tool'

export default defineAgentTool<{ city: string }>({
  description: '查询城市实时天气',
  parameters: Schema.object({
    city: Schema.string().required().description('城市名称，如上海'),
  }),
  requiresApproval: 'never',
  async execute({ city }) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`)
    return res.text()
  },
})
```

### 3. 不断线热重载与多平台 `configVersion: 2` 配置

`package.json#zhin.entry` 指向 `plugin.ts`（单文件 Bot 为 `bot.ts`）；挂载哪些适配器与子插件实例、以及每个实例的配置，统一写在 `zhin.config.yml` 中：

```yaml
# zhin.config.yml
configVersion: 2

http:
  host: 127.0.0.1
  port: 8068
  token: ${HTTP_TOKEN}

plugins:
  sandbox: '@zhin.js/adapter-sandbox'
  reminder: '@zhin.js/plugin-reminder'

sandbox:
  endpoints:
    - id: local-sandbox
      commandPrefix: /
```

## 一个 Bot 由什么组成

```text
 聊天平台            你的项目（一个插件）                              聊天平台
 QQ / Discord … ──▶ 适配器 ──▶ 中间件 ──▶ 命令 ─────────────────────▶ 适配器 ──▶ 回复
                                          │ 没有匹配到命令
                                          └──▶ AI Agent（可选）──▶ 工具
```

| 组成部分 | 是什么 | 写在哪里 |
|----------|--------|----------|
| **插件** | 你的项目本身就是 Root 插件；功能多了可拆成子插件包 | 入口写在 `package.json#zhin.entry`（`plugin.ts`）；子插件实例挂载在 `zhin.config.yml` 的 `plugins:` |
| **命令** | 用户发送 `/hello` 或 `/remind 10 喝水` 时执行 | `commands/<name>/index.ts` |
| **中间件** | 每条消息都会经过——关键词回复、限流、过滤 | `middlewares/<name>/index.ts` |
| **适配器** | 接入某个平台的 npm 包；一个适配器可挂多个账号 `endpoints` | `@zhin.js/adapter-*`，在 `zhin.config.yml` 中配置 |
| **AI Agent**（可选） | 回答没匹配到命令的消息，并调用你写的工具 | `tools/<name>/index.ts`，用 `npx zhin setup --ai` 启用 |
| **Console** | 浏览器管理后台：日志、配置、测试消息 | 本地 `/sandbox` 或 [console.zhin.dev](https://console.zhin.dev) |

```text
my-bot/
├── package.json      # zhin 字段：入口（"./plugin.ts"）与能力 features
├── zhin.config.yml   # configVersion: 2 —— 挂载插件、平台账号 endpoints、HTTP 端口
├── .env              # 密钥：HTTP_TOKEN、平台凭据、API Key
├── plugin.ts         # Root 插件入口：definePlugin()
├── commands/         # 命令——目录路径即命令名
├── middlewares/      # 每条消息都会经过
├── components/       # 可复用的 JSX 消息卡片
├── schedules/        # 定时任务
├── tools/            # 给 AI 调用的函数（可选）
└── pages/            # 自定义 Console 页面
```

下一步：[核心概念速览](./docs/getting-started/concepts.md) · [抽离第一个可复用子插件](./docs/getting-started/first-plugin.md) · [全部约定目录](./docs/authoring/conventions.md) · [命令详解](./docs/authoring/commands.md)

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
npx zhin setup --ai   # 选择模型服务预设（OpenAI、DeepSeek、通义千问、Anthropic、Ollama…）
pnpm install && pnpm dev
```

向导会自动安装 `@zhin.js/agent` 以及 `@zhin.js/tool`、`@zhin.js/prompt-section` 等 Feature，在 `zhin.config.yml` 开启 `ai.enabled: true`，并生成 `ai.plan.yml`（API Key 存入 `.env`），首次启动时自动导入运行时目录：

```yaml
# zhin.config.yml
ai:
  enabled: true
```

```yaml
# ai.plan.yml（由 `npx zhin setup --ai` 生成，首次启动自动导入）
version: 1
services:
  - id: openai
    label: OpenAI
    driver: openai
accounts:
  - id: openai-main
    label: OpenAI Default
    serviceId: openai
    authKind: api_key
    apiKey: ${OPENAI_API_KEY}
profiles:
  - id: default-chat
    label: Default Chat
    serviceId: openai
    accountId: openai-main
    model: gpt-4o-mini
defaults:
  chatProfileId: default-chat
```

之后，没匹配到命令的消息会交给模型回答——私聊默认触发，群里用 `ai:` 前缀或 @ 触发。往 `tools/` 里加文件即可赋予它新能力。

> Claude 订阅与 Antigravity：实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担。详见 [AI Provider](./docs/ai/providers.md)。

下一步：[AI 总览](./docs/ai/index.md) · [Agent 工具、Skill 与 Prompt Section](./docs/authoring/agent-tools.md) · [AI Agent 学习路径](./docs/paths/ai-agent.md)

## 按需安装

默认只装 IM 核心；AI、模型 SDK、MCP、图片渲染、语音都是可选包。启用 AI 时推荐使用 `npx zhin setup --ai`，它会一并写好依赖与 Feature 声明。

### Install tiers（zhin.js 1.1.x）

| 档位 | 安装 | 约 production 体积 | 能力 |
|------|------|-------------------|------|
| **IM** | `pnpm add zhin.js` + 适配器（如 `@zhin.js/adapter-sandbox`）；dev：`@zhin.js/cli` | **<10MB**（库包） | 内置命令、组件、中间件、定时任务与热重载运行时（按需在 `zhin.config.yml` 挂载适配器与插件，详见 [插件模型](/concepts/plugin-model)） |
| **AI** | `+ @zhin.js/agent zod ai` | +~12–15MB | ZhinAgent、会话、工具、压缩 |
| **Provider** | `+ @ai-sdk/openai` 等 | 按厂商 | 大模型调用 |
| **MCP** | `+ @modelcontextprotocol/sdk` | +~数 MB | MCP Client |
| **Rich media** | `+ @zhin.js/html-renderer` | 按平台（含原生引擎） | 出站 `html` / `markdown` 转 PNG（未装则降级 text） |
| **Speech** | `+ @zhin.js/speech` | +~数 MB | 入站 STT、出站 TTS、`segment.tts`（未装则 warn 降级） |

1.1 起，`ZhinAgent` / `AIService` 需从 `zhin.js/agent` / `zhin.js/ai` 导入，不再从 `zhin.js` 导出。表格来源：[`docs/snippets/install-tiers.md`](./docs/snippets/install-tiers.md)。

## 运营 / 群主：不写代码管好 Bot

部署完成后，日常运营全部在浏览器 [console.zhin.dev](https://console.zhin.dev) 完成：

- **看状态与收发消息**：查看各平台账号在线状态、回看群聊记录、直接在网页发消息。
- **无代码配置与任务中心**：开关插件、通过表单改配置、在「任务中心」按用途配置指定群欢迎语与定时提醒。
- **带护栏的群管与一键止损**：AI 起草公告或踢人等高风险动作须经人工审批；随时通过决策回放查原因，或一键切换静音 / 只读 / 紧急停止。

👉 完整指南：[运营与群管指南](./docs/customer/index.md) · [Console 管理路径](./docs/paths/console.md) · [按问题选方案](./docs/solutions/index.md)

## 文档导航

| 我想…… | 从这里开始 |
|--------|------------|
| 了解 Zhin 是什么 | [Zhin.js 是什么](./docs/getting-started/introduction.md) · [核心概念速览](./docs/getting-started/concepts.md) |
| 第一次跑起 Bot | [快速开始](./docs/getting-started/index.md) · [示例项目](./docs/examples/index.md) |
| 写命令、卡片与插件 | [第一个插件](./docs/getting-started/first-plugin.md) · [definePlugin 全景](./docs/authoring/define-plugin.md) · [插件完整交付](./docs/authoring/plugin-delivery.md) |
| 接入平台与本地化 | [平台适配器](./docs/adapters/index.md) · [配置参考](./docs/configuration/index.md) · [语言与本地化](./docs/configuration/localization.md) |
| 加 AI 与工具 | [AI 总览](./docs/ai/index.md) · [Agent 工具](./docs/authoring/agent-tools.md) · [Agent 深入](./docs/ai/agent.md) |
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
| [`@zhin.js/cli`](./basic/cli) | `zhin` 命令：启动、配置、诊断、迁移、发布 |
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
