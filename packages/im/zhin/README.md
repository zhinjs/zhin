# zhin.js

Zhin.js 主入口包 —— **AI Agent 运行时**聚合导出：多通道 **Endpoint**、**ZhinAgent** 编排、插件化与热重载。

本包 re-export **`@zhin.js/core` 全部 API**，并 selective re-export **`@zhin.js/agent`** 与多 Agent 编排 helper；**不包含** Host HTTP 栈（`@zhin.js/host-router`、`@zhin.js/host-api` 为可选插件，用于控制台与 REST 管理面）。

## 快速开始

### 创建项目

```bash
npm create zhin-app my-bot
cd my-bot
pnpm install
pnpm dev          # 开发模式（热重载）
```

### 配置文件

```yaml
# zhin.config.yml
endpoints:
  - context: icqq
    name: '123456789'   # 须先 icqq login，与 QQ 号一致

plugins:
  - "@zhin.js/adapter-icqq"
  # 可选：控制台与 Host REST（Stable 黄金路径见 examples/minimal-bot）
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"

ai:
  providers:
    ollama:
      api: ollama-chat
      host: "http://127.0.0.1:11434"
      # models 可省略 — ModelRegistry 自动 listModels
  agents:
    zhin:
      provider: ollama
      model: qwen3:14b   # 或省略由 Tier 选择；须出现在发现列表中
  agent:
    execSecurity: allowlist
    execPreset: custom
    execApprovalMode: ask
```

## 编写插件

```typescript
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addCommand, addTool, addCron } = usePlugin()

// 注册命令
addCommand(
  new MessageCommand('hello <name:string>')
    .desc('打招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)

// 注册 AI 工具
addTool(
  new ZhinTool('get_weather')
    .desc('查询天气')
    .param('city', { type: 'string', description: '城市名' }, true)
    .tag('天气', '生活')
    .keyword('天气', '气温')
    .execute(async ({ city }) => `${city}：晴，25°C`)
)

// 技能：在包内添加 skills/my-plugin/SKILL.md（由 Agent 扫描）
```

## 导出内容

入口为 [`src/index.ts`](./src/index.ts)：

| 来源 | 内容 |
|------|------|
| `@zhin.js/core` | `export *` — Plugin、Adapter、MessageDispatcher、Feature、Provider re-export 等 **全部 Core API** |
| `@zhin.js/agent` | **部分** re-export：`initAgentModule`（`initAIModule` 别名）、`ZhinAgent`、`AIService`、`ServiceAgent` 类型、`SessionManager`、Hook、Bootstrap、压缩/输出 helper 等（legacy `createAgent` 仍 re-export 自 `@zhin.js/ai`） |
| `./agent-orchestrator.js` | `runPipeline`、`runParallel`、`route` 及对应类型 |
| `@zhin.js/logger` | `logger` 默认导出与 `formatCompact` 等 |

未从本包导出的 Agent 能力（如 `AgentOrchestrator`、完整 builtin 工具工厂、`ExecPolicy` 细节）请直接 `import` **`@zhin.js/agent`**。Host 路由/API 来自可选插件 **`@zhin.js/host-router`** / **`@zhin.js/host-api`**，不在 `zhin.js` 包体内。

## 运行时挂载（本包特有）

Node 运行时（`src/runtime/node.ts`）在 IM 栈之上额外注册：

| 能力 | 说明 |
|------|------|
| `registerChatMessageStore` | `message.receive` / `message.send` → `im_transcripts`（ADR 0009）；LLM 历史由 `@zhin.js/agent` 写 `agent_messages` |
| `initAgentModule` | 挂载 `ctx.ai`、`ctx.agent`、DB 模型（`agent_*` + `im_transcripts`） |

详见 [AI 模块文档](https://zhin.js.org/advanced/ai) 与 [架构概览](../../docs/architecture-overview.md)。

## 运行时挂载（本包特有）

Node 运行时（`src/runtime/node.ts`）在 IM 栈之上额外注册：

| 能力 | 说明 |
|------|------|
| `registerChatMessageStore` | `message.receive` / `message.send` → `im_transcripts`（ADR 0009）；LLM 历史由 `@zhin.js/agent` 写 `agent_messages` |
| `initAgentModule` | 挂载 `ctx.ai`、`ctx.agent`、DB 模型（`agent_*` + `im_transcripts`） |

详见 [AI 模块文档](https://zhin.js.org/advanced/ai) 与 [架构概览](../../docs/architecture-overview.md)。

## 核心概念

- **Plugin** — 基本组织单位，通过 `usePlugin()` Hook 访问框架 API
- **Feature** — 统一抽象（Command、Tool、Skill、Cron、Database、Component、Config、Permission）
- **Adapter** — 多平台适配器（QQ、Discord、Telegram、KOOK 等 12 个平台）
- **MessageDispatcher** — 三阶段消息处理管线（Guardrail → Route → Handle）
- **ZhinAgent** — 内置 AI 智能体，支持工具调用、多轮对话、6 层 Bash 安全防御与 11 段结构化系统提示词
- **ExecPolicy** — 6 层纵深防御（环境变量剥离 → 包装器剥离 → 复合拆分 → 设备路径拦截 → 危险命令拦截 → 白名单验证）
- **CostTracker / FileStateCache / MicroCompact / ToolSearchCache** — AI 引擎性能优化模块

## AI 与多 Agent

本包在此层提供 **多 Agent 编排** API（内部调用 `ai.runAgent` → **agentLoop**）：

- **runPipeline(ai, steps, initialInput)** — 多步串联，每步输出作为下一步输入
- **runParallel(ai, tasks)** — 多 Agent 并行执行，返回 `Record<key, 输出>`
- **route(ai, content, rules, defaultOptions?)** — 按条件路由到不同专业 Agent

插件从 `zhin.js` 引入后，在 `useContext('ai', ...)` 内使用即可。按 bot/群组配置多个 ZhinAgent 的调度与路由规划在后续版本提供。

### 编排示例

以下示例中的 `prompt` / `systemPrompt` 可按需细化，使模型输出更稳定、格式更可控。

```typescript
import { useContext, runPipeline, runParallel, route } from 'zhin.js'

// 串联：先总结再翻译（每步的 {input} 会替换为上一步输出）
useContext('ai', async (ai) => {
  const result = await runPipeline(ai, [
    {
      prompt: '请严格用 3 条 bullet 总结以下内容，每条一行，不要多余解释：\n\n{input}',
      systemPrompt: '你是总结助手。只输出 3 条要点，每条一行，不要编号以外的多余文字。',
    },
    {
      prompt: '将以下中文要点逐条翻译成英文，保持 3 条、每行一条，不要增删内容：\n\n{input}',
      systemPrompt: '你是翻译。只输出翻译后的 3 行英文，不要前言或结语。',
    },
  ], userMessage)
})

// 并行：同时生成代码与文档
useContext('ai', async (ai) => {
  const out = await runParallel(ai, [
    {
      key: 'code',
      prompt: '用 TypeScript 写一个在控制台输出 "Hello World" 的示例，仅代码、无注释。',
      systemPrompt: '你只输出可运行的 TypeScript/JavaScript 代码，不要 markdown 包裹、不要解释。',
    },
    {
      key: 'doc',
      prompt: '为「在控制台打印 Hello World 的 TypeScript 程序」写一段 2–3 句的简短说明。',
      systemPrompt: '你只输出纯文本说明，2–3 句，不要代码块或标题。',
    },
  ])
  // out.code, out.doc
})

// 路由：按关键词分发给专业 Agent（{content} 会替换为用户原文）
useContext('ai', async (ai) => {
  const reply = await route(ai, userInput, [
    {
      when: (c) => /代码|code|实现|写一个|示例/.test(c),
      systemPrompt: '你是代码助手。根据用户需求只输出代码或最小可运行示例，必要时加一行注释说明运行方式。',
      prompt: '{content}',
    },
    {
      when: (c) => /翻译|translate|译成|译成英文/.test(c),
      systemPrompt: '你是翻译。只输出翻译结果，保持原有格式（列表/段落），不添加「翻译如下」等前缀。',
      prompt: '{content}',
    },
  ], { systemPrompt: '你是通用助手，简明回答用户问题。' })
})
```

## 常用命令

```bash
pnpm dev          # 开发模式（热重载 + 文件监听）
pnpm start        # 生产模式
npx zhin stop     # 停止守护进程
npx zhin new      # 创建插件模板
npx zhin build    # 构建插件
```

## 文档

- 站点首页：[zhin.js.org](https://zhin.js.org/)
- [快速开始](https://zhin.js.org/getting-started/)
- [核心概念](https://zhin.js.org/essentials/)
- [AI 模块](https://zhin.js.org/advanced/ai)
- [API 参考](https://zhin.js.org/api/)

## 许可证

MIT License
