# 架构概览

Zhin.js 采用分层架构设计，从底层通用基建到上层 IM 应用逐层抽象。每层职责明确、可独立使用，也可组合构建完整的聊天机器人应用。

## 分层架构图

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '14px' }}}%%
graph TB
  subgraph L5["🚀 zhin.js — 应用层"]
    direction LR
    L5A("启动引导") ~~~ L5B("配置加载") ~~~ L5C("插件加载") ~~~ L5D("Bot 连接") ~~~ L5E("AI 注册")
  end

  subgraph L4["🤖 @zhin.js/agent — Agent 编排层"]
    direction LR
    L4A("ZhinAgent") ~~~ L4B("AIService") ~~~ L4C("子任务") ~~~ L4D("用户画像") ~~~ L4E("引导文件")
  end

  subgraph L3["IM 层 + AI 引擎层"]
    direction LR
    subgraph L3A["💬 @zhin.js/core — IM 层"]
      direction TB
      C1("Plugin · Adapter · Bot")
      C2("Command · Middleware")
      C3("MessageDispatcher")
      C4("Tool · Skill · Component")
    end
    subgraph L3B["🧠 @zhin.js/ai — AI 引擎"]
      direction TB
      A1("Provider · Agent · Session")
      A2("Memory · Compaction")
      A3("Output · RateLimiter")
      A4("Storage · ContextManager")
    end
  end

  subgraph L2["⚙️ @zhin.js/kernel — 运行时内核"]
    direction LR
    L2A("PluginBase") ~~~ L2B("Feature") ~~~ L2C("Cron · Scheduler") ~~~ L2D("错误体系") ~~~ L2E("工具函数")
  end

  subgraph L1["📦 基础层 basic/"]
    direction LR
    L1A("@zhin.js/logger") ~~~ L1B("@zhin.js/database") ~~~ L1C("@zhin.js/schema") ~~~ L1D("@zhin.js/cli")
  end

  L5 --> L4
  L4 --> L3
  L3 --> L2
  L2 --> L1

  classDef appLayer fill:#2e7d32,stroke:#1b5e20,color:#fff,rx:8
  classDef agentLayer fill:#1565c0,stroke:#0d47a1,color:#fff,rx:8
  classDef coreLayer fill:#e65100,stroke:#bf360c,color:#fff,rx:8
  classDef aiLayer fill:#6a1b9a,stroke:#4a148c,color:#fff,rx:8
  classDef kernelLayer fill:#37474f,stroke:#263238,color:#fff,rx:8
  classDef basicLayer fill:#4e342e,stroke:#3e2723,color:#fff,rx:8
  classDef nodeStyle fill:#ffffff22,stroke:none,color:#fff

  class L5 appLayer
  class L4 agentLayer
  class L3A coreLayer
  class L3B aiLayer
  class L2 kernelLayer
  class L1 basicLayer
  class L5A,L5B,L5C,L5D,L5E,L4A,L4B,L4C,L4D,L4E,L2A,L2B,L2C,L2D,L2E,L1A,L1B,L1C,L1D,C1,C2,C3,C4,A1,A2,A3,A4 nodeStyle
```

## 各层详解

### 基础层 (`basic/`)

框架无关的基础设施，所有上层包共享的底层能力。

| 包名 | 路径 | 说明 |
|------|------|------|
| `@zhin.js/logger` | `basic/logger` | 结构化日志系统，支持多级别、彩色输出 |
| `@zhin.js/database` | `basic/database` | 统一数据库抽象（SQLite、MySQL、MongoDB 等） |
| `@zhin.js/schema` | `basic/schema` | 配置校验与序列化 |
| `@zhin.js/cli` | `basic/cli` | 命令行工具（dev、start、new、build、pub） |

### @zhin.js/kernel（运行时内核）

**与 IM/AI 无关的通用运行时**，可独立用于 Web 后端、CLI 工具、自动化脚本等任意 Node.js 应用。

| 模块 | 说明 |
|------|------|
| `PluginBase` | 轻量级插件系统，支持 DI（provide/inject）、生命周期、插件树结构 |
| `Feature` | 可追踪、可序列化的插件功能基类，支持变更事件 |
| `Cron` | 基于 croner 的 cron 表达式调度器 |
| `Scheduler` | 持久化定时任务调度系统，可自定义 JobStore |
| 错误体系 | `ZhinError` 层级 + `RetryManager` + `CircuitBreaker` + `ErrorManager` |
| 工具函数 | `evaluate`/`execute`（vm 沙盒）、`compiler`（模板）、`Time`（时间常量）等 |

### @zhin.js/ai（AI 引擎层）

**与 IM 无关的通用 AI 引擎**，可独立用于任何需要 LLM 集成的应用。

| 模块 | 说明 |
|------|------|
| `AIProvider` | LLM 提供者统一接口（OpenAI、Anthropic、Ollama、DeepSeek、Moonshot、Zhipu 等） |
| `Agent` | 无状态 Agent 引擎，执行多轮 tool-calling 循环 |
| `ModelRegistry` | 模型自动发现、Tier 评分、缓存与智能选择（支持自动降级） |
| `SessionManager` | 会话管理（内存 / 数据库持久化） |
| `ContextManager` | 上下文管理，消息记录与摘要 |
| `ConversationMemory` | 短期滑动窗口 + 长期链式摘要 |
| `compaction` | 上下文窗口管理，token 估算、分阶段摘要、历史修剪 |
| `CostTracker` | Token 用量与成本追踪，支持按模型/Provider 统计 |
| `FileStateCache` | 文件状态缓存，减少重复磁盘读取 |
| `MicroCompact` | 微压缩引擎，增量式上下文摘要 |
| `ToolSearchCache` | 工具搜索结果缓存，加速重复查找 |
| `output` | AI 文本解析为结构化 `OutputElement[]`（文本/图片/音频/卡片等） |
| `RateLimiter` | 请求速率限制 |
| `ToneDetector` | 消息情绪感知 |
| `Storage` | 统一存储抽象（内存 / 数据库可热切换） |

### @zhin.js/core（IM 层）

**IM 聊天机器人的核心框架**，在 kernel 基础上添加 IM 领域概念。

| 模块 | 说明 |
|------|------|
| `Plugin` | 完整的插件类，实现 `PluginLike` 接口，含 IM 特有功能（消息中间件、命令、组件） |
| `Adapter` | 适配器抽象基类，管理 Bot 连接、群管理方法自动检测 |
| `Bot` | Bot 接口，规范连接/发消息/撤回/格式化等方法 |
| `MessageDispatcher` | 消息三阶段调度：Guardrail → Route → Handle |
| `Feature` 子类 | `CommandFeature`、`ToolFeature`、`SkillFeature`、`CronFeature`、`DatabaseFeature`、`ComponentFeature`、`PermissionFeature`、`ConfigFeature` |
| 消息类型 | `Message`、`MessageElement`、`segment`（消息段工具） |

### @zhin.js/agent（Agent 编排层）

**IM 场景下的 AI Agent 编排**，在 `@zhin.js/ai` 基础上添加 IM 集成逻辑。

| 模块 | 说明 |
|------|------|
| `ZhinAgent` | AI 全局大脑，编排工具选择、多轮对话、引导文件注入 |
| `AIService` | AI 服务管理器，Provider 注册与路由 |
| `SubagentManager` | 后台子任务管理 |
| `FollowUpManager` | 定时跟进提醒 |
| `UserProfileStore` | 用户画像管理（跨会话个性化） |
| `PersistentCronEngine` | AI 感知的持久化 cron 引擎 |
| `BootstrapLoader` | 引导文件加载（SOUL.md / AGENTS.md / TOOLS.md） |
| `ExecPolicy` | Bash 执行安全（6 层纵深防御：黑名单、环境变量剥离、wrapper 剥离、复合命令拆分、只读放行、审批集成） |
| `FilePolicy` | 文件访问安全（路径检查、设备路径拦截、命令读写分类） |
| `PromptBuilder` | 系统提示词构建器（10 段结构化架构） |
| Hook 系统 | `message:received`、`tool:call`、`session:compact` 等事件钩子 |
| 内置工具 | `bash`、`read_file`、`write_file`、`ask_user`、`web_search`、`chat_history` 等 |

### zhin.js（应用层）

**面向终端用户的主入口包**，组合所有层并提供一键启动能力。

| 模块 | 说明 |
|------|------|
| 配置加载 | 从 `zhin.config.yml` / `.ts` 加载配置 |
| 插件加载 | 自动发现和加载插件（支持热重载） |
| Bot 连接 | 按配置连接各平台适配器的 Bot |
| AI 注册 | 初始化 AI Provider、Agent、SessionManager |
| 信号处理 | 优雅关闭（SIGINT/SIGTERM） |
| 重新导出 | 导出 `@zhin.js/core`、`@zhin.js/agent`、`@zhin.js/kernel` 的全部公开 API |

## 依赖关系

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '13px', 'lineColor': '#78909c' }}}%%
graph TD
  zhin(["🚀 zhin.js"])
  agent(["🤖 @zhin.js/agent"])
  core(["💬 @zhin.js/core"])
  ai(["🧠 @zhin.js/ai"])
  kernel(["⚙️ @zhin.js/kernel"])
  cli(["🔧 @zhin.js/cli"])

  subgraph basic["📦 基础层"]
    logger(["📝 logger"])
    database(["🗄️ database"])
    schema(["📐 schema"])
  end

  croner(["⏰ croner"])

  zhin ==> agent
  zhin -.-> cli
  agent ==> core
  agent ==> ai
  core ==> kernel
  core -.-> database
  core -.-> schema
  kernel ==> logger
  kernel -.-> croner
  ai ==> logger

  classDef app fill:#2e7d32,stroke:#1b5e20,color:#fff,rx:12
  classDef agentC fill:#1565c0,stroke:#0d47a1,color:#fff,rx:12
  classDef coreC fill:#e65100,stroke:#bf360c,color:#fff,rx:12
  classDef aiC fill:#6a1b9a,stroke:#4a148c,color:#fff,rx:12
  classDef kernelC fill:#37474f,stroke:#263238,color:#fff,rx:12
  classDef basicC fill:#5d4037,stroke:#3e2723,color:#fff,rx:12
  classDef extC fill:#546e7a,stroke:#37474f,color:#fff,rx:12

  class zhin app
  class agent agentC
  class core coreC
  class ai aiC
  class kernel kernelC
  class cli extC
  class logger,database,schema basicC
  class croner extC

  linkStyle 0,2,3,4,7,9 stroke:#42a5f5,stroke-width:2px
  linkStyle 1,5,6,8 stroke:#90a4ae,stroke-width:1px,stroke-dasharray:5
```

核心设计原则：

- **kernel** 和 **ai** 不依赖任何 IM 概念，可被非 IM 应用直接使用
- **core** 只依赖 kernel，引入 IM 领域概念
- **agent** 桥接 core + ai，实现 IM 场景的 AI 编排
- **zhin.js** 作为 facade 层，组合所有包并提供完整的应用启动流程

## 消息处理流程

入站顺序（与源码一致）：平台 → **`Adapter.emit('message.receive')`**（内部 **`await MessageDispatcher.dispatch`**）→ **`await` 根插件 `message.receive`（生命周期）** → 再通知 **`adapter.on('message.receive')` 注册的观察者**（如控制台 UI）。默认路由 **`exclusive`**（命令与 AI 互斥）；双轨见配置 `dispatcher.mode: dual`。详见仓库根目录 **`AGENTS.md`** 与 [消息如何流转](/essentials/message-flow)。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '13px' }}}%%
flowchart TD
  A([" 📨 用户消息 "]) --> B["Adapter_Bot_接收规范化"]
  B --> C["Adapter_emit_message_receive"]
  C --> D["MessageDispatcher_dispatch"]

  D --> E{" 🛡️ Guardrail "}
  E -->|" ❌ 拒绝 "| Z(["丢弃"])
  E -->|" ✅ 通过 "| F{" 🔀 Route_默认exclusive "}

  F -->|" ⌨️ 命令匹配 "| G["CommandFeature\n命令处理"]
  F -->|" 🤖 AI 触发 "| H["ZhinAgent"]

  H --> I["🎯 工具收集\nSkill粗筛 → Tool细筛"]
  I --> J["📋 构建上下文"]
  J --> K{" Agent 路由 "}

  K -->|" 💬 闲聊 "| L["纯对话\n1次LLM"]
  K -->|" ⚡ 预执行 "| M["快速路径"]
  K -->|" 🔧 工具调用 "| N["多轮tool_calling"]

  G --> O
  L --> O
  M --> O
  N --> O
  O([" 📤 Dispatcher内处理与回复 "])
  O --> P[" 根Plugin_message_receive_生命周期"]
  P --> Q[" adapter_on观察者可选"]

  classDef input fill:#e3f2fd,stroke:#1565c0,color:#0d47a1,rx:20
  classDef output fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20,rx:20
  classDef drop fill:#ffebee,stroke:#c62828,color:#b71c1c,rx:20
  classDef guard fill:#d32f2f,stroke:#b71c1c,color:#fff
  classDef route fill:#f57c00,stroke:#e65100,color:#fff
  classDef aiNode fill:#1565c0,stroke:#0d47a1,color:#fff,rx:8
  classDef process fill:#f5f5f5,stroke:#bdbdbd,color:#424242,rx:6
  classDef routeNode fill:#7b1fa2,stroke:#4a148c,color:#fff

  class A input
  class P,Q output
  class Z drop
  class E guard
  class F route
  class H,I,J aiNode
  class K routeNode
  class B,C,D,G,L,M,N,O process
```

## 出站消息（发送链）

所有「机器人主动发到会话」的逻辑应走 **同一套发送管道**，避免在 core 中新增与 `Adapter.sendMessage` 并行的旁路 API。

**推荐链（概念顺序）**：

1. 业务或框架代码调用 **`Message.$reply(...)`**，或直接调用 **`Adapter.sendMessage(...)`**（与具体 Bot API 封装一致）。
2. **`Adapter`** 内经过 **`renderSendMessage`** 等渲染/规范化（如 segment → 平台格式）。
3. **根插件** 的 **`before.sendMessage`** 生命周期：可读取/改写即将发出的 `options`（例如统一润色 `content`、审计、限流）。
4. 最终落到具体 **`Bot` / 平台 SDK**（如 `bot.$sendMessage`）。

**Dispatcher 出站润色（`packages/core/src/built/dispatcher.ts`）**：在调用 `$reply` 的异步上下文中，用 **`AsyncLocalStorage`** 标记「本次发送由 Dispatcher 发起的回复」；`addOutboundPolish` 向根注册额外的 **`before.sendMessage`**，仅在存储命中时修改 `options.content`。这样润色与**普通插件发消息**走同一 `before.sendMessage` 链，行为一致、可组合。

扩展阅读：`docs/advanced/ai.md`（若涉及 AI 触发与出站）；根目录 **`AGENTS.md`**（速查表）。

## 插件系统

Zhin.js 使用 `AsyncLocalStorage` 实现插件上下文管理。开发者通过 `usePlugin()` 获取当前插件 API：

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand, addTool, onMounted } = usePlugin()
```

插件支持：
- **依赖注入** — `provide` / `inject` / `useContext`
- **生命周期** — `onMounted` / `onDispose`
- **热重载** — 文件修改后自动重载（dev 模式）
- **树状结构** — 子插件自动继承父插件上下文

## 适配器与群管理

适配器通过覆写 `IGroupManagement` 接口方法来声明群管理能力。`Adapter.start()` 会自动检测已覆写的方法并生成对应的 **AI 工具**；技能说明由包内 `skills/`（SKILL.md）提供：

```typescript
class MyAdapter extends Adapter<MyBot> {
  async kickMember(botId, sceneId, userId) { /* ... */ }
  async muteMember(botId, sceneId, userId, duration) { /* ... */ }

  async start() {
    await super.start() // 自动检测 → 生成 Tool → 注册 Skill
  }
}
```

## 可复用性

由于 `@zhin.js/kernel` 和 `@zhin.js/ai` 与 IM 无关，它们可被直接用于：

- Web 后端服务的插件架构
- CLI 工具的模块化设计
- AI 驱动的自动化脚本
- 任何需要 DI + 生命周期管理的 Node.js 应用
- 任何需要 LLM 集成（对话、工具调用、记忆）的应用

```typescript
import { PluginBase } from '@zhin.js/kernel'
import { Agent, OpenAIProvider } from '@zhin.js/ai'

const app = new PluginBase({ name: 'my-web-app' })
const provider = new OpenAIProvider({ apiKey: '...' })
const agent = new Agent(provider, logger)
```
