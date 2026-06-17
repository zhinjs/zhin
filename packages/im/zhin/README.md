# zhin.js

Zhin.js **IM 核心**主入口（4.x）：多通道 **Endpoint**、Plugin、Adapter、命令与热重载。**production 安装预算 <10MB**。

AI / Agent 能力在 **`@zhin.js/agent`**（及 `@zhin.js/ai`），须显式安装或通过 `npm create zhin-app` 向导写入依赖。详见 [ADR 0019](../../../docs/adr/0019-install-size-layering.md)。

## Install tiers

> **SSOT**：[`docs/snippets/install-tiers.md`](../../../docs/snippets/install-tiers.md)（含 Host 行扩展表）。站点：[快速开始](https://zhin.js.org/getting-started/#install-tierszhinjs-4x)。

| 档位 | 安装 | 能力 |
|------|------|------|
| **IM** | `pnpm add zhin.js` | `@zhin.js/core` 全部 API |
| **AI** | `+ @zhin.js/agent zod ai` | ZhinAgent、`ctx.ai`、会话与工具 |
| **Provider** | `+ @ai-sdk/openai` 等 | 大模型调用 |
| **Host** | `+ @zhin.js/host-router @zhin.js/host-api` | Console API（可选 peer） |

## 子路径导出

| 子路径 | 内容 |
|--------|------|
| `zhin.js` | **仅** `@zhin.js/core` + `@zhin.js/logger` |
| `zhin.js/agent` | `@zhin.js/agent` + 多 Agent 编排（`runPipeline` / `runParallel` / `route`） |
| `zhin.js/ai` | `@zhin.js/ai` 引擎 API |
| `zhin.js/node` | `bootstrapNode` 启动入口 |
| `zhin.js/jsx*` | Satori JSX 运行时 |

**4.x breaking**：`import from 'zhin.js'` 不再含 `ZhinAgent`、`AIService`、`ModelRegistry`。请改用 `zhin.js/agent` 或 `zhin.js/ai`。

## 快速开始

### 创建项目

```bash
npm create zhin-app my-bot
cd my-bot
pnpm install
pnpm dev          # 开发模式（热重载）
```

向导可选启用 AI（自动写入 agent 栈与 provider 依赖）。

### 配置文件（IM 最小示例）

```yaml
# zhin.config.yml
endpoints: []

plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
  - hello

ai:
  enabled: false   # 仅 IM；启用 AI 见下节
```

### 启用 AI

```bash
pnpm add @zhin.js/agent zod ai @ai-sdk/openai
```

```yaml
ai:
  enabled: true
  providers:
    openai-main:
      sdk: openai
      apiKey: "${OPENAI_API_KEY}"
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o
```

参考：[examples/full-bot](../../../examples/full-bot/)、[AI 模块文档](https://zhin.js.org/advanced/ai)。

## 编写插件

```typescript
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addCommand, addTool } = usePlugin()

addCommand(
  new MessageCommand('hello <name:string>')
    .desc('打招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)

// AI 工具（须已安装 @zhin.js/agent 且 ai.enabled）
addTool(
  new ZhinTool('get_weather')
    .desc('查询天气')
    .param('city', { type: 'string', description: '城市名' }, true)
    .execute(async ({ city }) => `${city}：晴，25°C`)
)
```

访问 `ctx.ai` / 编排 API 时从 **`zhin.js/agent`** 引入类型与 helper（或 `@zhin.js/agent`）。

## 运行时挂载（`zhin.js/node`）

`bootstrapNode` 在 IM 栈之上（**当已安装 `@zhin.js/agent`** 时）额外注册：

| 能力 | 说明 |
|------|------|
| `registerChatMessageStore` | `message.receive` / `message.send` → `im_transcripts` |
| `initAgentModule` | 挂载 `ctx.ai`、`ctx.agent`、DB 模型（`agent_*`） |

详见 [AI 模块文档](https://zhin.js.org/advanced/ai) 与 [架构概览](../../../docs/architecture-overview.md)。

## 核心概念

- **Plugin** — 基本组织单位，通过 `usePlugin()` 访问框架 API
- **Feature** — Command、Tool、Skill、Cron、Database 等统一抽象
- **Adapter / Endpoint** — 多平台接入（QQ、Discord、Sandbox 等）
- **MessageDispatcher** — 入站消息调度（命令 vs AI 触发）
- **ZhinAgent** — `@zhin.js/agent` 提供的 IM 编排运行时（非主包默认导出）

## 多 Agent 编排

安装 agent 栈后，从 **`zhin.js/agent`** 使用：

```typescript
import { useContext, runPipeline, runParallel, route } from 'zhin.js/agent'

useContext('ai', async (ai) => {
  const result = await runPipeline(ai, [
    { prompt: '总结：\n\n{input}', systemPrompt: '三条 bullet。' },
    { prompt: '翻译成英文：\n\n{input}', systemPrompt: '仅输出译文。' },
  ], userMessage)
})
```

## 常用命令

```bash
pnpm dev          # 开发模式（热重载）
pnpm start        # 生产模式
npx zhin stop     # 停止守护进程
npx zhin doctor   # 诊断（含 AI 依赖）
```

## 文档

- [zhin.js.org](https://zhin.js.org/)
- [快速开始](https://zhin.js.org/getting-started/)
- [Install tiers / ADR 0019](https://zhin.js.org/adr/0019-install-size-layering)
- [AI 模块](https://zhin.js.org/advanced/ai)

## 许可证

MIT License
