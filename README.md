<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>为生产环境构建 agent 产品的 TypeScript 框架</strong><br />
  <strong>The TypeScript framework for building production-grade agent products</strong><br />
  分层可组合 · Agent-first · 安全内置 · 工程纪律由 harness 强制<br />
  <sub>Composable layers · Agent-first runtime · Built-in security · Harness-enforced discipline</sub>
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
  <a href="https://zhin.js.org">Documentation</a> ·
  <a href="https://demo.zhin.dev">Live Demo</a> ·
  <a href="https://console.zhin.dev">Remote Console</a> ·
  <a href="./docs/contributing.md">Contributing</a>
</p>

---

Zhin.js 为**在生产环境构建严肃 bot / agent 产品**的开发者和团队而生——多通道 IM 接入（私聊、群聊、记忆、定时、通知），**不是** Cursor / Claude Code 类 coding agent。四根支柱：

- **分层可组合** — `basic → kernel → ai → core → agent → zhin` 单向依赖由 harness 强制；`@zhin.js/kernel` 可脱离 IM 作纯插件内核，`@zhin.js/ai` 可独立作 LLM 引擎
- **Agent-first** — 完整 agent runtime（编排、工具、MCP、记忆与压缩、子代理），不是"接 LLM SDK"的插件
- **安全内置** — exec 白名单 / 文件策略 / 网络白名单 / 资源预算 / 审计日志五层防御 + 声明式策略表
- **工程纪律即产品** — 50+ harness 门禁守护架构分层、消息发送链路、安装体积（IM 核心 `<10MB`）、依赖策略

> **EN**: Built for developers and teams running serious bot/agent products in production. Composable layers (kernel works standalone as a plugin engine, `@zhin.js/ai` as an IM-free LLM engine), an agent-first runtime (orchestration, tools, MCP, memory & compaction, subagents), five-layer built-in security, and 50+ harness gates enforcing architecture, message paths, and install size. **Not** a Cursor/Claude Code-style coding agent. See [capability tiers](./docs/essentials/capability-tiers.md).

```ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello <name:word>')
    .desc('打个招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)
```

## Quick Start

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` 走 IM-only 黄金路径：Sandbox + Host API + Remote Console，无需云模型 Key。

| 路径 | 适合谁 |
|------|--------|
| [**demo.zhin.dev**](https://demo.zhin.dev) | 零安装体验 |
| `npm create zhin-app -y` | 独立项目（推荐） |
| [`examples/minimal-bot`](./examples/minimal-bot/) | 贡献者 / monorepo 调试 |

然后打开 [Remote Console](https://console.zhin.dev)，填 Host `http://127.0.0.1:8086` 与 `.env` 中的 `HTTP_TOKEN`，在 Sandbox 发 `hello` / `card`。

更多：[5 分钟首跑](./docs/getting-started/first-run.md) · `npx zhin setup` · `npx zhin doctor`

**要求**：Node.js `^20.19.0` 或 `>=22.12.0`，pnpm 9+

## Features

- **IM 优先** — Plugin / Adapter / Endpoint、命令、热重载；`pnpm add zhin.js` **&lt;10MB**
- **插件化** — `usePlugin()` Hooks + AsyncLocalStorage 上下文
- **Remote Console** — Host 只提供 API；UI 在 [console.zhin.dev](https://console.zhin.dev)
- **可选 AI** — `@zhin.js/agent`：对话、工具、MCP、安全 harness
- **多通道** — QQ / Discord / Telegram / Slack / GitHub 等，见 [adapters](./plugins/adapters)
- **文件化创作面** — `agent/tools`、`agent/skills`、workspace agents（见 [agent-authoring](./docs/advanced/agent-authoring.md)）

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

> **SSOT**：[`docs/snippets/install-tiers.md`](./docs/snippets/install-tiers.md) · 在线：[Install tiers](https://zhin.js.org/getting-started/#install-tierszhinjs-4x)

| 档位 | 安装 | 约 production 体积 | 能力 |
|------|------|-------------------|------|
| **IM** | `pnpm add zhin.js` | **<10MB** | Plugin、Adapter、Endpoint、命令、Sandbox |
| **AI** | `+ @zhin.js/agent zod ai` | +~12–15MB | ZhinAgent、会话、工具、压缩 |
| **Provider** | `+ @ai-sdk/openai` 等 | 按厂商 | 大模型调用 |
| **MCP** | `+ @modelcontextprotocol/sdk` | +~数 MB | MCP Client / memoryMcp |
| **Rich media** | `+ @zhin.js/html-renderer` | +~数 MB | 出站 `html` / `markdown` 转 PNG（未装则降级 text） |
| **Speech** | `+ @zhin.js/speech` | +~数 MB | 入站 STT、出站 TTS、`segment.tts`（未装则 warn 降级） |

Breaking（4.x）：`import from 'zhin.js'` 不再含 `ZhinAgent` / `AIService`；请 `import from 'zhin.js/agent'` 或 `zhin.js/ai`。详见 [ADR 0019](./docs/adr/0019-install-size-layering.md)。

> **Windows**：见 [Windows 初始化指南](./docs/essentials/windows-setup.md)。

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

深入：[AI 模块](./docs/advanced/ai.md) · [Agent 安全](./docs/advanced/agent-harness-engineering.md) · [工具与技能](./docs/advanced/tools-skills.md)

## Adapters

| 平台 | 包名 | 平台 | 包名 |
|------|------|------|------|
| Sandbox（Stable） | `@zhin.js/adapter-sandbox` | QQ / ICQQ | `@zhin.js/adapter-icqq` |
| QQ 官方 | `@zhin.js/adapter-qq` | NapCat | `@zhin.js/adapter-napcat` |
| OneBot 11 / 12 | `@zhin.js/adapter-onebot11` / `onebot12` | Discord | `@zhin.js/adapter-discord` |
| Telegram | `@zhin.js/adapter-telegram` | Slack | `@zhin.js/adapter-slack` |
| KOOK / 钉钉 / 飞书 | `kook` / `dingtalk` / `lark` | GitHub | `@zhin.js/adapter-github` |
| Email / 企微 / LINE | `email` / `wecom` / `line` | Satori / WeChat MP | `satori` / `wechat-mp` |

完整说明：[适配器文档](./docs/essentials/adapters.md) · [`plugins/adapters`](./plugins/adapters)

## Package Map

| 包 | 角色 |
|----|------|
| [`zhin.js`](./packages/im/zhin) | IM 入口（4.x） |
| [`@zhin.js/core`](./packages/im/core) | Plugin / Adapter / Dispatcher |
| [`@zhin.js/ai`](./packages/im/ai) | 无 IM 的 AI 引擎 |
| [`@zhin.js/agent`](./packages/im/agent) | Agent 编排与安全 |
| [`@zhin.js/cli`](./basic/cli) · [`create-zhin-app`](./packages/toolkit/create-zhin) | CLI / 脚手架 |

分层与依赖方向：[架构概览](./docs/architecture-overview.md) · [仓库结构](./docs/contributing/repo-structure.md)

## Documentation

| | |
|--|--|
| **入门** | [快速开始](./docs/getting-started/index.md) · [路线与边界](./docs/vision.md) · [稳定性承诺](./docs/stability.md) · [Docker](./docs/getting-started/docker.md) · [Windows](./docs/essentials/windows-setup.md) |
| **基础** | [核心概念](./docs/essentials/index.md) · [配置](./docs/essentials/configuration.md) · [命令](./docs/essentials/commands.md) · [插件](./docs/essentials/plugins.md) |
| **进阶** | [AI](./docs/advanced/ai.md) · [Agent 创作面](./docs/advanced/agent-authoring.md) · [消息流](./docs/essentials/message-flow.md) |
| **开发** | [插件开发](./docs/guide/plugin-development.md) · [贡献](./docs/contributing.md) · [架构](./docs/architecture/README.md) |

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

见 [贡献指南](./docs/contributing.md)。根目录 `pnpm dev` 指向 Stable 黄金路径 `minimal-bot`；厨房水槽用 `pnpm dev:test`（`test-bot`），**非**用户模板。

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
