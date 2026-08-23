<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>一套代码，跑遍所有聊天平台的 TypeScript bot 框架</strong><br />
  多通道 · 按需 AI · Remote Console
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
  <a href="./docs/contributing/development.md">贡献指南</a>
</p>

---

Zhin.js 为**在聊天平台做严肃 bot / 助手产品**的开发者和团队而生（私聊、群聊、定时、通知、AI 对话），**不是** Cursor / Claude Code 类 coding agent。三个核心词：

- **多通道** — 一套代码跑 20+ 平台（QQ / 微信 / Discord / Slack / 钉钉 / Telegram…），一个 bot 可同时挂多个账号、多个平台
- **按需 AI** — 默认只是 &lt;10MB 的 IM 框架；装上 `@zhin.js/agent` 就是完整 Agent（工具 / 记忆 / 编排 / MCP），装多少用多少
- **Remote Console** — 浏览器里管 bot：发消息、改配置、看日志、管定时任务，全程不用碰代码

```ts
// bot.ts — 整个机器人可以就是这一份文件
import { defineCommand } from 'zhin.js/command'
import { definePlugin } from 'zhin.js/plugin-runtime'

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

## Quick Start

三步，不用写适配器样板：

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

打开 [Remote Console](https://console.zhin.dev) → Host 填 `http://127.0.0.1:8086` → Sandbox 发 `/hello`。完事。

`-y` 走 IM 黄金路径：Sandbox + Host + Console，**不需要任何模型 Key**。

| 路径 | 适合谁 | 要多久 |
|------|--------|--------|
| [**demo.zhin.dev**](https://demo.zhin.dev) | 零安装点一点 | 立刻 |
| `npm create zhin-app -y` | 独立项目（推荐） | ~1 分钟 |
| [`examples/single-file-bot`](./examples/single-file-bot/) | 看「一个 `bot.ts` 就是 bot」 | 克隆后 `pnpm --filter single-file-bot dev` |
| [`examples/minimal-bot`](./examples/minimal-bot/) | 贡献者 / 约定目录样板 | 根目录 `pnpm dev` |

更多：[安装与启动](./docs/getting-started/index.md) · [示例速览](./docs/examples/index.md) · `npx zhin setup` · `npx zhin doctor`

**要求**：Node.js `^20.19.0` 或 `>=22.12.0`（跑 Plugin Runtime 示例推荐 **≥22.6**），pnpm 9+

## Features

- **IM 优先** — 命令、组件、热重载；`pnpm add zhin.js` **&lt;10MB**
- **插件化** — 文件约定 + 声明式 API（`definePlugin` / `defineCommand` / `defineAdapter`）
- **Remote Console** — Host 只提供 API；UI 在 [console.zhin.dev](https://console.zhin.dev)
- **可选 AI** — `@zhin.js/agent`：对话、工具、MCP、安全策略
- **多通道** — QQ / 微信 / Discord / Telegram / Slack / GitHub 等，见 [adapters](./plugins/adapters)
- **文件化创作面** — `commands/`、`tools/`、`agent/skills`（见 [agent-authoring](./docs/authoring/agent-tools.md)）

<details>
<summary><strong>Stable / Advanced 能力分档</strong></summary>

| Tier | 特性 | 说明 |
|------|------|------|
| **Stable** | IM 核心 | Sandbox + 命令 + Console |
| **Stable** | AI（可选） | `@zhin.js/agent` + provider |
| **Stable** | 插件 / 热重载 / TypeScript | Hooks API、完整类型 |
| **Stable** | 安全（基础） | Bash allowlist、文件策略、审批 |
| **Advanced** | 多 Endpoint | IM / 邮件 / GitHub / Webhook… |
| **Advanced** | Feature / MCP / toolSearch | 编排、deferred worker |

</details>

### Install tiers（zhin.js 4.x）

> **SSOT**：[`docs/snippets/install-tiers.md`](./docs/snippets/install-tiers.md) · 在线：[Install tiers](https://zhin.js.org/getting-started/#install-tierszhinjs-4x) · English: [`README.md`](./README.md)

| 档位 | 安装 | 约 production 体积 | 能力 |
|------|------|-------------------|------|
| **IM** | `pnpm add zhin.js` + 适配器（如 `@zhin.js/adapter-sandbox`）；dev：`@zhin.js/cli` | **<10MB**（库包） | Plugin Runtime、命令/组件/适配器约定目录（Stable Features 由 `@zhin.js/core` 的 `zhin.features` 继承；Host 为 optional peer + `zhin.plugins`，见 [插件模型](/concepts/plugin-model)） |
| **AI** | `+ @zhin.js/agent zod ai` | +~12–15MB | ZhinAgent、会话、工具、压缩 |
| **Provider** | `+ @ai-sdk/openai` 等 | 按厂商 | 大模型调用 |
| **MCP** | `+ @modelcontextprotocol/sdk` | +~数 MB | MCP Client |
| **Rich media** | `+ @zhin.js/html-renderer` | +~数 MB | 出站 `html` / `markdown` 转 PNG（未装则降级 text） |
| **Speech** | `+ @zhin.js/speech` | +~数 MB | 入站 STT、出站 TTS、`segment.tts`（未装则 warn 降级） |

Breaking（4.x）：`import from 'zhin.js'` 不再含 `ZhinAgent` / `AIService`；请 `import from 'zhin.js/agent'` 或 `zhin.js/ai`。详见 [ADR 0019](./docs/snippets/install-tiers.md)。

> **Windows**：见 [Windows 初始化指南](./docs/getting-started/index.md)。

## Enable AI（optional）

```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # 按需替换
```

```yaml
# zhin.config.yml
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
  agent:
    execSecurity: allowlist
    execApprovalMode: ask
```

深入：[AI 模块](./docs/ai/index.md) · [Agent 安全](./docs/ai/agent.md) · [工具与技能](./docs/authoring/agent-tools.md)

## Adapters

| 平台 | 包名 | 平台 | 包名 |
|------|------|------|------|
| Sandbox（Stable） | `@zhin.js/adapter-sandbox` | QQ / ICQQ | `@zhin.js/adapter-icqq` |
| QQ 官方 | `@zhin.js/adapter-qq` | NapCat | `@zhin.js/adapter-napcat` |
| OneBot 11 / 12 | `@zhin.js/adapter-onebot11` / `onebot12` | Discord | `@zhin.js/adapter-discord` |
| Telegram | `@zhin.js/adapter-telegram` | Slack | `@zhin.js/adapter-slack` |
| KOOK / 钉钉 / 飞书 | `kook` / `dingtalk` / `lark` | GitHub | `@zhin.js/adapter-github` |
| Email / 企微 / LINE | `email` / `wecom` / `line` | Satori / WeChat MP | `satori` / `wechat-mp` |

完整说明：[适配器文档](./docs/adapters/index.md) · [`plugins/adapters`](./plugins/adapters)

## Package Map

| 包 | 角色 |
|----|------|
| [`zhin.js`](./packages/im/zhin) | IM 入口（4.x） |
| [`@zhin.js/core`](./packages/im/core) | Plugin / Adapter / Dispatcher |
| [`@zhin.js/ai`](./packages/im/ai) | 无 IM 的 AI 引擎 |
| [`@zhin.js/agent`](./packages/im/agent) | Agent 编排与安全 |
| [`@zhin.js/cli`](./basic/cli) · [`create-zhin-app`](./packages/toolkit/create-zhin) | CLI / 脚手架 |

分层与依赖方向：[架构概览](./docs/concepts/architecture.md) · [仓库结构](./docs/contributing/repo-structure.md)

## Documentation

| | |
|--|--|
| **入门** | [快速开始](./docs/getting-started/index.md) · [路线与边界](./docs/index.md) · [稳定性承诺](./docs/concepts/generation-lifecycle.md) · [Docker](./docs/contributing/development.md) · [Windows](./docs/getting-started/index.md) |
| **基础** | [核心概念](./docs/concepts/architecture.md) · [配置](./docs/configuration/index.md) · [命令](./docs/authoring/commands.md) · [插件](./docs/concepts/plugin-model.md) |
| **进阶** | [AI](./docs/ai/index.md) · [Agent 创作面](./docs/authoring/agent-tools.md) · [消息流](./docs/concepts/message-flow.md) |
| **开发** | [插件开发](./docs/authoring/define-plugin.md) · [贡献](./docs/contributing/development.md) · [架构](./docs/concepts/architecture.md) |

站点：[zhin.js.org](https://zhin.js.org)

## CLI

```bash
pnpm dev                 # 开发（本仓默认 minimal-bot；维护者回归用 pnpm dev:test）
npx zhin new my-plugin   # 插件模板
npx zhin setup           # 增量配置向导
npx zhin doctor          # 环境诊断
npx zhin search <kw>     # 搜插件
```

## Contributing

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install && pnpm build
cd examples/minimal-bot && pnpm dev
```

见 [贡献指南](./docs/contributing/development.md)。根目录 `pnpm dev` 指向 Stable 约定目录样板 `minimal-bot`；想看「一个文件就是 bot」用 `pnpm --filter single-file-bot dev`。厨房水槽用 `pnpm dev:test`（`test-bot`），**非**用户模板。

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
