# 面向 AI / 代理的仓库说明

本文件帮助自动化工具（Cursor、GitHub Copilot、Codex 等）快速对齐本 monorepo 的**架构心智模型**与目录约定。

| 文档 | 用途 |
|------|----------------|
| **本文 (`AGENTS.md`)** | 速览：分层、关键入口文件、入/出站消息链 |
| [docs/architecture-overview.md](./docs/architecture-overview.md) | 分层详解、Mermaid 流程图、插件与适配器 |
| [docs/contributing/repo-structure.md](./docs/contributing/repo-structure.md) | **事实来源**：工作区 glob、`src`/`lib`/`client`/`dist`、命名 |

---

## 架构分层（速览）

由下至上：**`basic/`**（日志、DB、schema、CLI）→ **`@zhin.js/kernel`**（PluginBase、Feature、调度与错误体系，**无 IM 概念**）→ **`@zhin.js/ai`**（Provider、Agent、Memory，**无 IM 概念**）→ **`@zhin.js/core`**（Plugin、Adapter、Bot、MessageDispatcher、命令/中间件/工具/技能）→ **`@zhin.js/agent`**（ZhinAgent、AIService、IM 侧编排）→ **`zhin.js` 主包**（配置加载、插件发现、统一 re-export）。

- **改「消息怎么进、命令怎么路由、AI 怎么接」**：优先 `packages/core` + `packages/agent`。  
- **改「纯 LLM/记忆/Provider」**：优先 `packages/ai`。  
- **改「插件运行时、与 IM 无关的 DI/生命周期」**：优先 `packages/kernel`。

---

## 核心入口与文件（常用）

| 领域 | 路径 |
|------|------|
| IM 插件、中间件、命令、生命周期 | `packages/core/src/plugin.ts` |
| 适配器、收发消息、渲染发送 | `packages/core/src/adapter.ts` |
| Bot 抽象 | `packages/core/src/bot.ts` |
| 消息三阶段调度（Guardrail / Route / Handle） | `packages/core/src/built/dispatcher.ts` |
| Agent 编排、与 core 的衔接 | `packages/agent/`（见各子模块） |
| 类型与对外协议补充 | `packages/core/src/types.ts` |

---

## 消息路径（概念）

**入站（简）**：平台 → `Adapter` / `Bot` 收消息 → `Adapter.emit('message.receive')` 串行：`await MessageDispatcher.dispatch` → `await` 根插件 `message.receive`（生命周期）→ 再通知 `adapter.on('message.receive')` 观察者。无 Dispatcher 时不再走根 `middleware` 回退；默认路由为 **exclusive**（命令与 AI 互斥，与 `createMessageDispatcher` 默认一致）。

**出站（发送链，勿绕开）**：业务侧通过 **`Message.$reply` / `Adapter.sendMessage`** 等同一路径 → `renderSendMessage` → **根插件** `before.sendMessage`（可在此统一改写 `options.content`）→ 底层 `bot.$sendMessage`。  

**Dispatcher 出站润色**：`built/dispatcher.ts` 在「$reply 调用栈」上用 **AsyncLocalStorage** 挂上回复上下文；`addOutboundPolish` 通过为根再注册 **`before.sendMessage`**，在存储命中时才润色，从而与适配器发送逻辑**完全一致**（不要单独造 `Plugin#sendMessage` 旁路）。

详见：[docs/architecture-overview.md](./docs/architecture-overview.md) 中「消息处理流程」与「出站消息（发送链）」。

---

## 工作区（pnpm）

- `packages/*` — 框架与 `@zhin.js/*` 核心包  
- `basic/*` — CLI、数据库、日志等基础库  
- `plugins/adapters|services|features|utils/*` — 适配器与插件  
- `examples/*`、`docs` — 示例与文档  

## 构建与目录语义（每个插件/包）

| 侧 | 源码 | 产物 |
|----|------|------|
| Node 服务端 | `src/` | `lib/` |
| 浏览器 | `client/` | `dist/`（包根下的 `dist/`） |

## `@zhin.js/console` 特例

- 服务端：`plugins/services/console/src/` → `lib/`  
- 控制台 SPA：`plugins/services/console/client/`（内含 Vite 应用的 `client/src/`）→ 静态构建到该包的 `dist/`  
- 适配器「控制台扩展」：各适配器包根的 `client/`（常为扁平 `index.tsx`）→ 该适配器包根 `dist/`  

## 贡献入口

- 人类贡献指南：[docs/contributing.md](./docs/contributing.md)  
- 结构与命名事实来源：[docs/contributing/repo-structure.md](./docs/contributing/repo-structure.md)  
