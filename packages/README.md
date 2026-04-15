# Zhin.js Packages

核心包目录，包含框架运行所必需的模块。

> 本目录下除 `core`、`zhin` 外，其余包目录与主仓库同属 **单一 Git 仓库**（pnpm workspace），不再使用 submodule。

## 开发约定

新增包、目录命名与 **`src/`→`lib/`**、**`client/`→`dist/`** 等规则，见仓库统一文档：  
**[仓库结构与模块化约定](../docs/contributing/repo-structure.md)**。

## 包列表

| 包名 | 路径 | 说明 | 子模块 |
|------|------|------|--------|
| [`zhin.js`](./zhin/) | `packages/zhin` | 主入口包，组合所有层并重新导出全部公开 API | — |
| [`@zhin.js/core`](./core/) | `packages/core` | IM 核心框架：Plugin、Adapter、Bot、Command、MessageDispatcher、Feature 子类 | — |
| [`@zhin.js/kernel`](./kernel/) | `packages/kernel` | 运行时内核：PluginBase、Feature、Cron、Scheduler、错误体系、工具函数 | ⊕ [zhinjs/kernel](https://github.com/zhinjs/kernel) |
| [`@zhin.js/ai`](./ai/) | `packages/ai` | AI 引擎：Provider、Agent、Session、Memory、Compaction、Output | ⊕ [zhinjs/ai](https://github.com/zhinjs/ai) |
| [`@zhin.js/agent`](./agent/) | `packages/agent` | Agent 编排：ZhinAgent、AIService、子任务、用户画像、引导文件 | ⊕ [zhinjs/agent](https://github.com/zhinjs/agent) |
| [`@zhin.js/client`](./client/) | `packages/client` | Web 控制台 React 客户端 | ⊕ [zhinjs/client](https://github.com/zhinjs/client) |
| [`@zhin.js/satori`](./satori/) | `packages/satori` | HTML/CSS → SVG/PNG 渲染引擎 | ⊕ [zhinjs/satori](https://github.com/zhinjs/satori) |
| [`create-zhin-app`](./create-zhin/) | `packages/create-zhin` | 项目脚手架 CLI | ⊕ [zhinjs/create-zhin](https://github.com/zhinjs/create-zhin) |

## 架构概览

```
zhin.js (应用层)
  ├── @zhin.js/agent (Agent 编排)
  │     ├── @zhin.js/core (IM 核心)
  │     │     └── @zhin.js/kernel (运行时内核)
  │     └── @zhin.js/ai (AI 引擎)
  │
  ├── @zhin.js/client (Web 控制台)
  └── @zhin.js/satori (渲染引擎)
```

### @zhin.js/kernel — 通用运行时内核
- PluginBase（插件 DI + 生命周期）
- Feature（可追踪功能抽象）
- Cron / Scheduler（定时任务）
- 错误体系（ZhinError + RetryManager + CircuitBreaker）
- 工具函数（vm 沙盒求值、模板编译、时间常量等）

### @zhin.js/ai — 通用 AI 引擎
- AIProvider（OpenAI / Anthropic / Ollama / DeepSeek / Moonshot / Zhipu）
- Agent（多轮 tool-calling 循环）
- SessionManager / ContextManager / ConversationMemory
- Compaction（上下文窗口管理）
- Output（结构化输出解析）

### @zhin.js/core — IM 核心框架
- Plugin（完整插件系统，含命令、中间件、组件）
- Adapter / Bot（适配器抽象，群管理自动检测）
- MessageDispatcher（Guardrail → Route → Handle）
- Feature 子类（Command、Tool、Skill、Cron、Database、Component、Config、Permission）

### @zhin.js/agent — AI Agent 编排
- ZhinAgent（AI 全局大脑）
- AIService（Provider 管理）
- SubagentManager / FollowUpManager / UserProfileStore
- 引导文件（SOUL.md / AGENTS.md / TOOLS.md）
- 内置工具（bash、read_file、web_search 等）

> kernel 和 ai 不依赖任何 IM 概念，可被非 IM 应用直接使用。详见 [架构概览](../docs/architecture-overview.md)。

## 基础层依赖

核心包依赖 `basic/` 目录下的基础模块：

| 包名 | 路径 | 说明 | 子模块 |
|------|------|------|--------|
| `@zhin.js/cli` | `basic/cli` | 命令行工具（dev、start、new、build、pub） | ⊕ [zhinjs/cli](https://github.com/zhinjs/cli) |
| `@zhin.js/database` | `basic/database` | 数据库抽象层（SQLite、MySQL、MongoDB 等） | ⊕ [zhinjs/database](https://github.com/zhinjs/database) |
| `@zhin.js/logger` | `basic/logger` | 日志系统 | ⊕ [zhinjs/logger](https://github.com/zhinjs/logger) |
| `@zhin.js/schema` | `basic/schema` | Schema 校验与序列化 | ⊕ [zhinjs/schema](https://github.com/zhinjs/schema) |
