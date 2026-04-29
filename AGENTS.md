# 面向 AI / 代理的仓库说明

本文件帮助自动化工具（Cursor、GitHub Copilot、Codex 等）快速对齐本 monorepo 的**架构心智模型**与目录约定。

| 文档 | 用途 |
|------|----------------|
| **本文 (`AGENTS.md`)** | 速览：分层、关键入口文件、入/出站消息链 |
| [docs/architecture-overview.md](./docs/architecture-overview.md) | 分层详解、Mermaid 流程图、插件与适配器 |
| [docs/architecture/im-queue-outbound-invariants.md](./docs/architecture/im-queue-outbound-invariants.md) | **Harness / Tier1**：IM·队列·出站不变量短清单（勿绕开发送链） |
| [docs/architecture/harness-engineering-sources.md](./docs/architecture/harness-engineering-sources.md) | Harness Engineering 依据索引（OpenAI、Fowler、中文综述说明） |
| [docs/architecture/agent-context-blocks.md](./docs/architecture/agent-context-blocks.md) | Agent 系统提示词 §1–§10 分段契约与 debug 导出 |
| [docs/architecture/queue-im-field-contract.md](./docs/architecture/queue-im-field-contract.md) | 队列 payload 与 IM `SendOptions` / `Message` 字段对齐表 |
| [docs/architecture/event-contracts.md](./docs/architecture/event-contracts.md) | 队列事件 `kind` / `type` / `detail` 推荐形状 |
| [docs/contributing/repo-structure.md](./docs/contributing/repo-structure.md) | **事实来源**：工作区 glob、`src`/`lib`/`client`/`dist`、命名 |

---

## 架构分层（速览）

由下至上：**`basic/`**（日志、DB、schema、CLI）→ **`@zhin.js/kernel`**（PluginBase、Feature、调度与错误体系，**无 IM 概念**）→ **`@zhin.js/ai`**（Provider、Agent、ModelRegistry，按子模块组织：`agent/`（Agent 引擎 + CostTracker + ToolFilter）、`memory/`（Session + Context + ConversationMemory）、`compaction/`（分阶段摘要 + MicroCompact + token 估算），**无 IM 概念**）→ **`@zhin.js/core`**（Plugin、Adapter、Bot、MessageDispatcher、命令/中间件/工具/技能；AI Provider 从 `@zhin.js/ai` 选择性 re-export）→ **`@zhin.js/agent`**（AgentOrchestrator 五类注册表、ZhinAgent、AIService、PromptBuilder-10段架构，按子模块组织：`orchestrator/`（ToolRegistry + SkillRegistry + SubAgentRegistry + McpRegistry + HookRegistry）、`discovery/`（tools/skills/agents 文件化发现）、`security/`（ExecPolicy-6层安全 + FilePolicy）、`mcp-client/`（MCP 连接管理）、`defaults/`（默认工具/子代理/Hook 注册））→ **`zhin.js` 主包**（配置加载、插件发现、项目根锁定、直接 re-export `@zhin.js/core` + `@zhin.js/agent`）。

- **改「消息怎么进、命令怎么路由、AI 怎么接」**：优先 `packages/core` + `packages/agent`。
- **改「纯 LLM/记忆/Provider」**：优先 `packages/ai`（`agent/`、`memory/`、`compaction/` 子目录）。
- **改「插件运行时、与 IM 无关的 DI/生命周期」**：优先 `packages/kernel`。
- **改「AI 编排注册、工具/技能/MCP 管理」**：优先 `packages/agent/src/orchestrator/`。

---

## 核心入口与文件（常用）

| 领域 | 路径 |
|------|------|
| IM 插件、中间件、命令、生命周期 | `packages/core/src/plugin.ts` |
| 适配器、收发消息、渲染发送 | `packages/core/src/adapter.ts` |
| Bot 抽象 | `packages/core/src/bot.ts` |
| 消息三阶段调度（Guardrail / Route / Handle） | `packages/core/src/built/dispatcher.ts` |
| **Agent 编排中枢**（五类注册表） | `packages/agent/src/orchestrator/` |
| 工具注册表（权限、过滤、ZhinTool 契约） | `packages/agent/src/orchestrator/tool-registry.ts` |
| 技能 / 子代理 / MCP / Hook 注册表 | `packages/agent/src/orchestrator/{skill,subagent,mcp,hook}-registry.ts` |
| 文件化发现（tools/skills/agents） | `packages/agent/src/discovery/` |
| Bash 执行安全（6 层纵深防御） | `packages/agent/src/security/exec-policy.ts` |
| 文件访问安全（路径检查、设备拦截、命令分类） | `packages/agent/src/security/file-policy.ts` |
| MCP 客户端连接管理 | `packages/agent/src/mcp-client/` |
| 系统提示词构建（10 段结构化架构） | `packages/agent/src/zhin-agent/prompt.ts` |
| AI 内置工具（bash、read_file、ask_user 等） | `packages/agent/src/builtin-tools.ts` |
| 适配器群管工具自动生成 | `packages/agent/src/common-adapter-tools.ts` |
| Agent 引擎（无 IM 的工具循环） | `packages/ai/src/agent/` |
| 会话与上下文记忆 | `packages/ai/src/memory/` |
| 上下文压缩与自动摘要 | `packages/ai/src/compaction/` |
| 模型自动发现、Tier 评分与降级 | `packages/ai/src/model-registry.ts` |
| 类型与对外协议补充 | `packages/core/src/types.ts` |
| 项目根锁定（防 chdir 导致路径偏移） | `packages/zhin/src/setup/project-root.ts` |

### `@zhin.js/agent` 子模块结构

```
packages/agent/src/
├── orchestrator/          # AgentOrchestrator + 五类 ResourceRegistry
│   ├── index.ts           #   聚合入口
│   ├── types.ts           #   Tool/Skill/SubAgent/MCP/Hook 类型
│   ├── resource-registry.ts #  通用注册表基类（公共 vs agentId 作用域）
│   ├── tool-registry.ts   #   IM 工具权限、ZhinTool 契约
│   ├── skill-registry.ts  #   Skill 注册与评分搜索
│   ├── subagent-registry.ts # 子代理 + AgentPreset
│   ├── mcp-registry.ts    #   MCP 服务端条目与连接聚合
│   └── hook-registry.ts   #   AI 生命周期 Hook
├── discovery/             # 文件化能力发现
│   ├── tools.ts           #   *.tool.md 扫描与构建
│   ├── skills.ts          #   SKILL.md 扫描与依赖检查
│   ├── agents.ts          #   *.agent.md 预设发现
│   └── utils.ts           #   路径、目录列表工具
├── security/              # 安全策略（从 zhin-agent/ 与根迁出）
│   ├── exec-policy.ts     #   bash 多段纵深校验
│   └── file-policy.ts     #   文件/设备/命令安全分类
├── mcp-client/            # MCP 客户端
│   ├── connection.ts      #   单连接生命周期
│   ├── bridge.ts          #   MCP→AgentTool/Resource 转换
│   └── index.ts           #   McpClientManager
├── defaults/              # 默认资源注册
│   ├── tools.ts           #   内置工具 → orchestrator
│   ├── subagents.ts       #   内置子代理
│   └── hooks.ts           #   默认 Hook
├── init/                  # 模块初始化
│   ├── register-orchestrator.ts  # provide('agent', orchestrator)
│   ├── register-builtin-tools.ts
│   └── create-zhin-agent.ts
├── zhin-agent/            # ZhinAgent 核心
│   ├── index.ts           #   ZhinAgent 类
│   ├── prompt.ts          #   10 段系统提示词
│   └── tool-collector.ts  #   工具收集与粗筛
├── builtin-tools.ts       # 全部内置工具定义
├── common-adapter-tools.ts # 适配器群管工具生成
└── subagent.ts            # SubagentManager
```

### `@zhin.js/ai` 子模块结构

```
packages/ai/src/
├── agent/                 # Agent 引擎（无 IM）
│   ├── index.ts           #   Agent 类、createAgent
│   ├── cost-tracker.ts    #   按模型的 token/USD 成本追踪
│   └── tool-filter.ts     #   TF-IDF 工具相关性过滤与缓存
├── memory/                # 会话与上下文管理
│   ├── session.ts         #   SessionManager（内存/DB 双实现）
│   ├── context-manager.ts #   按场景落库、历史与总结
│   └── conversation-memory.ts # 话题切换 + 链式摘要长期记忆
├── compaction/            # 上下文压缩
│   ├── compaction.ts      #   分阶段摘要、上下文窗口守护、自动压缩
│   ├── micro-compact.ts   #   旧工具结果轻量占位清理
│   └── token-counter.ts   #   极简 token 估算
├── providers/             # LLM Provider 实现
├── model-registry.ts      # 模型发现/Tier/降级
└── types.ts               # AI 类型定义
```

---

## 消息路径（概念）

**入站（简）**：平台 → `Adapter` / `Bot` 收消息 → `Adapter.emit('message.receive')` 串行：`await MessageDispatcher.dispatch` → `await` 根插件 `message.receive`（生命周期）→ 再通知 `adapter.on('message.receive')` 观察者。无 Dispatcher 时不再走根 `middleware` 回退；默认路由为 **exclusive**（命令与 AI 互斥，与 `createMessageDispatcher` 默认一致）。

**出站（发送链，勿绕开）**：业务侧通过 **`Message.$reply` / `Adapter.sendMessage`** 等同一路径 → `renderSendMessage` → **根插件** `before.sendMessage`（可在此统一改写 `options.content`）→ 底层 `bot.$sendMessage`。  

**Dispatcher 出站润色**：`built/dispatcher.ts` 在「$reply 调用栈」上用 **AsyncLocalStorage** 挂上回复上下文；`addOutboundPolish` 通过为根再注册 **`before.sendMessage`**，在存储命中时才润色，从而与适配器发送逻辑**完全一致**（不要单独造 `Plugin#sendMessage` 旁路）。

详见：[docs/architecture-overview.md](./docs/architecture-overview.md) 中「消息处理流程」与「出站消息（发送链）」。

---

## AI 能力文件约定

除程序化注册外，框架自动扫描约定目录中的声明文件，按 `cwd/` > `~/.zhin/` > `data/` > 插件包根 的顺序发现，同名先发现者优先。

| 目录 | 文件格式 | 说明 |
|------|---------|------|
| `tools/` | `*.tool.md` | 文件化 AI Tool。frontmatter 定义参数/元数据，可选 `handler` 或 body 模板（`{{param}}` 替换）。程序化同名 Tool 优先。 |
| `skills/` | `<name>/SKILL.md` | 文件化 Skill。粗筛描述 + 关联工具列表。`always: true` 常驻注入。 |
| `agents/` | `*.agent.md` | 文件化 Agent 预设。frontmatter + body 作为 systemPrompt。 |
| 包根 | `plugin.yml` | 插件清单（`name`/`description`/`version`），`plugin.manifest` 访问。 |

详见：[docs/advanced/tools-skills.md](./docs/advanced/tools-skills.md)、[docs/contributing/repo-structure.md §9](./docs/contributing/repo-structure.md)。

---

## 工作区（pnpm workspace 单仓库）

本仓库采用 **pnpm workspace** 管理多个包目录；**不再使用 git submodule**。克隆后 `pnpm install` 即可，无需 `git submodule update`。

**主仓库内常驻包**：`packages/core`、`packages/zhin`、`examples/*`；其余 `basic/*`、`packages/kernel|ai|agent|…`、`plugins/`、`docs/` 等均为**同一 Git 仓库内的普通路径**（历史上曾对应 `github.com/zhinjs/<name>` 独立仓库，迁移说明见 [docs/contributing/monorepo-no-submodules.md](./docs/contributing/monorepo-no-submodules.md)）。

- `packages/*` — 框架与 `@zhin.js/*` 核心包  
- `basic/*` — CLI、数据库、日志等基础库  
- `plugins/adapters|services|features|utils/*` — 适配器与插件  
- `examples/*`、`docs` — 示例与文档  

## 构建与目录语义（每个插件/包）

| 侧 | 源码 | 产物 |
|----|------|------|
| Node 服务端 | `src/` | `lib/` |
| 浏览器 | `client/` | `dist/`（包根下的 `dist/`） |

## `@zhin.js/console` 架构（对齐 page-manager）

控制台采用 **page-manager** 三层分包架构：

| 包 | 职责 |
|---|---|
| `@zhin.js/console-types` | 共享类型与常量（`ConsoleEntry`、`PluginRegisterHostApi`、`ConsolePluginRegister` 等） |
| `@zhin.js/console-core`（双端） | **Node**：`PageManager` 类、`EntryStore`、esbuild 管线（`/@dev`/`/@assets`/`/esm` 路由）、`attachConsoleClientHost`（Farm 同栈/静态）；**Browser**：`createRegistryStore` + `useRegistry`（`useSyncExternalStore`）、`cn` 工具 |
| `@zhin.js/console-app` | Farm + React 默认壳 SPA（`client/main.tsx` 挂载 React 单例 + `ConsoleWebHost`）+ `src/register.ts` → `lib/register.js`（内置 `GET /entries`） |
| `@zhin.js/client`（精简） | `app` 单例（`addRoute`/`addTool`/`defineSidebar`/`defineToolbar` + `useSyncExternalStore`）、WebSocket 仅业务数据、re-export `console-types` + `console-core/browser` |
| `plugins/services/console` | 胶水层：`new PageManager` + `mountConsoleRouter` + `pm.start()`；WebSocket 仅业务逻辑；provide `PageManager` 作为 `web` 上下文 |

**插件注册**：适配器通过 `PageManager.addEntry({ id, development, production })` 注册客户端入口；浏览器侧插件模块 `export function register(api: PluginRegisterHostApi)` 使用 `api.React.createElement`（共享 React 单例）、`api.addRoute`、`api.addTool`。

**共享依赖**：`/console/esm/*.mjs` 提供 canonical ESM（react、react-dom 等），esbuild 按需打包 + 缓存，不再需要 import map / farm-peer-shim。

**构建顺序**：`console-types` (tsup) → `console-core` (tsc×2) → `client` (tsc) → `console-app` (tsc server + farm build) → `console` (tsup)。

## 贡献入口

- 人类贡献指南：[docs/contributing.md](./docs/contributing.md)  
- 结构与命名事实来源：[docs/contributing/repo-structure.md](./docs/contributing/repo-structure.md)  
