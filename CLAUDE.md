# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **See also**: `AGENTS.md` for the universal agent entry point; `.github/copilot-instructions.md` for detailed API patterns and plugin examples.

## Project Overview

Zhin.js is a TypeScript chatbot framework — AI-driven, plugin-based, hot-reload, multi-platform. ESM-only (`"type": "module"`), targets Node.js ^20.19.0 || >=22.12.0.

## Commands

```bash
pnpm build              # Full build (sequential: basic/ → packages/ → plugins/)
pnpm test               # Run all Vitest tests
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report
pnpm lint               # ESLint (.ts,.tsx)
pnpm type-check         # tsc --noEmit
pnpm dev                # Start test-bot (examples/test-bot) with hot-reload
pnpm clean              # Clean all lib/ dist/ directories

# Single package
pnpm --filter @zhin.js/core build
pnpm --filter @zhin.js/core test

# Run a single test file
pnpm vitest run packages/im/core/tests/plugin.test.ts
```

Custom lint checks:
- `pnpm check:harness-paths` — 检测插件是否绕过 Adapter.sendMessage 直调 bot.$sendMessage
- `pnpm check:no-koa` — 检测插件是否直接 import koa（应使用 RouterContext）
- `pnpm check:prod` — 检查生产环境配置（无 console.log/debugger/TODO/FIXME）
- `pnpm check:plugin` — 检查插件是否符合标准规范（入口文件、测试、README）

## Architecture

Monorepo managed with **pnpm 9.0.2 workspaces** (no Turborepo). Versioning via **Changesets**.

### Dependency layers (bottom → top)

```
basic/                      # @zhin.js/logger, schema, database, cli
  ↓
packages/im/kernel          # Runtime kernel (no IM concepts)
  ↓
packages/im/ai              # AI engine (providers, agents, memory, compaction)
  ↓
packages/im/core            # IM framework (Plugin, Adapter, Endpoint, Command, MessageDispatcher)
  ↓
packages/im/agent           # Agent orchestration (ZhinAgent, security policies, MCP client)
  ↓
packages/im/zhin            # Main entry — IM core (4.x); agent via optional peer + zhin.js/agent

packages/console/{contract,pagemanager,client}  # 控制台栈（平行，不经 IM 发送链）
packages/toolkit/{create-zhin,satori}         # 脚手架与渲染库
```

### Key packages at a glance

| Package | Path | Role |
|---------|------|------|
| kernel | `packages/im/kernel/src/` | PluginBase, Feature, Cron, Scheduler, error hierarchy |
| ai | `packages/im/ai/src/` | Provider abstraction, Agent, ModelRegistry, Memory, Compaction, CostTracker |
| core | `packages/im/core/src/` | Plugin (AsyncLocalStorage), Adapter, Endpoint, Command, MessageDispatcher |
| agent | `packages/im/agent/src/` | ZhinAgent orchestrator, security (ExecPolicy, FilePolicy), MCP client |
| host-router | `packages/host/router/src/` | Koa 监听、Router、Bearer/CORS |
| host-api | `packages/host/api/src/` | Host 管理面 REST、Console 协议、entries |

### Outbound send chain (do not bypass)

IM stack: `Message.$reply` / `Adapter.sendMessage` → `renderSendMessage` → root plugin `before.sendMessage` → platform `Endpoint`. All outbound must go through this chain — no parallel `Plugin#sendMessage` bypass.

### Plugin system

Uses **AsyncLocalStorage** for context management. `usePlugin()` must be called at module top-level (not inside async functions). Plugins auto-mount on `start()`, unmount on `stop()`.

Context/DI: `provide()` registers, `inject()` / `useContext()` consumes. Return a cleanup function from `useContext` callback for lifecycle management.

### Build output

- Most packages: `src/` → `lib/` (via `tsc`)
- Client package: `src/` → `dist/`
- Dual exports: `./lib/index.js` (production) + `./src/index.ts` (development condition)
- Module resolution uses `conditions: ['development']` in tests to resolve `src/` directly

### TypeScript configuration

All packages extend `tsconfig.base.json`（根目录），只需设置 `outDir`、`rootDir`、`types`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "outDir": "./lib",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["lib", "node_modules"]
}
```

## Testing

**Vitest 4.1.8** with globals enabled (no need to import `describe`, `it`, `expect`).

Key config (`vitest.config.ts`):
- Environment: `node`
- Isolation: `false` locally, `true` in CI (avoids `vi.spyOn` leakage)
- Timeout: 10s
- Test pattern: `**/*.test.ts`
- Excludes: `**/lib/**`, `**/packages/toolkit/satori/**`
- Coverage thresholds: lines 50%, branches 40%
- Setup file sets `process.env.NODE_ENV = 'test'`

## Key Conventions

- **Import paths**: Use `.js` extensions for TS files (`import { foo } from './bar.js'`)
- **TypeScript**: Strict mode, ES2022 target, ESNext modules, bundler resolution, decorators enabled
- **JSX**: Plugins use `jsx: "react-jsx"` with `jsxImportSource: "zhin.js"` (not React)
- **Type augmentation**: Extend `zhin.js` module for custom contexts, adapters, models
- **Workspace filtering**: `pnpm --filter <package-name>` for targeted commands

## CI

GitHub Actions (`ci.yml`): Install (pnpm cache) → changeset check → build → type-check → lint → harness checks → test+coverage. Runs on PR to `main`, Node.js 24, ubuntu-latest, 15-min timeout.

Publish workflow (`publish.yml`): On push to `main`, auto-bumps versions via Changesets and publishes to npm. Includes pnpm cache and type-check.

## Harness Engineering

详细文档请参考：
- [Harness Engineering 指南](docs/contributing/harness-engineering.md) — 项目级 harness engineering
- [Agent Harness Engineering 指南](docs/advanced/agent-harness-engineering.md) — Agent 安全策略

### 核心原则

1. **架构约束优先** — 通过自动化检查强制执行架构边界
2. **早期发现** — 在 CI 中捕获问题，而非生产环境
3. **明确规范** — 所有约束必须文档化并可验证
4. **最小化例外** — 任何绕过检查都需要明确的理由和审批

### 快速检查

```bash
pnpm check:all              # 运行所有 harness 检查
pnpm check:harness-paths    # 检查发送链路绕过
pnpm check:no-koa           # 检查 koa 导入
pnpm check:prod             # 检查生产配置
pnpm check:plugin           # 检查插件规范
pnpm check:architecture     # 检查架构层级
```

### Agent 安全策略

Agent harness engineering 提供多层安全防护：

1. **执行策略** — 命令执行安全检查（5 层防御）
2. **文件策略** — 文件访问安全检查（4 层防御）
3. **网络策略** — 网络访问安全检查（域名白名单、私有 IP 阻止）
4. **预算限制** — 资源使用限制（Token/Cost、调用次数、时长）
5. **审计日志** — 安全事件追踪
6. **沙箱环境** — 进程隔离和资源限制

详细配置请参考 [Agent Harness Engineering 指南](docs/advanced/agent-harness-engineering.md)。

### Agent 调度器

Agent 调度器提供角色管理和工具权限控制：

- **7 种预定义角色**：main, subtask, worker, researcher, executor, reviewer, planner
- **工具权限继承**：每种角色有独立的工具集
- **任务依赖管理**：支持任务依赖验证
- **上下文隔离**：角色特定的系统提示词

### 提示词构建器

提示词构建器提供分层提示词组装：

- **分层结构**：系统、角色、任务、上下文、工具、安全、约束、示例、记忆
- **动态注入**：运行时构建提示词
- **安全规则嵌入**：8 条核心安全规则
- **上下文窗口管理**：优先级排序、字符数截断

### 任务续传机制

任务续传机制支持复杂任务的智能分解和续传：

- **智能任务分解**：自动分析任务复杂度，分解为子任务
- **进度追踪**：记录每个子任务的完成状态
- **续传能力**：当达到迭代限制时，可以继续执行未完成的任务
- **上下文保持**：续传时保持之前的上下文和进度

配置示例：
```typescript
{
  maxIterations: 15,  // 增加到15次，支持复杂任务
  timeout: 120_000,   // 增加到2分钟
  maxSubagentIterations: 25,  // 增加子任务迭代次数
  subagentTurnWaitMs: 300_000,  // 增加等待时间到5分钟
}
```

### 消息处理状态适配层

消息处理状态适配层提供统一的接口来提示用户"AI 正在处理"：

- **多平台支持**：ICQQ（消息回应）、其他平台（发送消息）
- **可配置**：支持 reaction、message、typing、none 等类型
- **自动管理**：自动开始和停止提示
- **平台适配**：不同平台可以有不同的实现方式

配置示例：
```typescript
import { TypingIndicatorManager, ICQQTypingIndicatorAdapter } from '@zhin.js/agent';

const manager = new TypingIndicatorManager({
  type: 'reaction',
  emoji: '⏳',
  autoRemove: true,
});

// 注册 ICQQ 适配器
manager.registerAdapter(new ICQQTypingIndicatorAdapter(...));

// 使用
const indicator = await manager.start({
  platform: 'icqq',
  endpointId: '75318',
  sessionId: 'private:liuchunlang',
  messageId: '123456',
  sceneType: 'private',
});

// 处理完成后停止
await indicator.stop();
```

### 架构层级检查

项目依赖层级必须严格遵守：

```
basic/ (logger, schema, database, cli)
  ↓
packages/im/kernel (无 IM 概念)
  ↓
packages/im/ai (providers, agents, memory)
  ↓
packages/im/core (Plugin, Adapter, Endpoint, Command)
  ↓
packages/im/agent (ZhinAgent, security policies)
  ↓
packages/im/zhin (主入口)
```

**禁止的导入**：
- `packages/im/kernel` 不能导入 `core` / `agent` / `zhin` 层
- `packages/im/ai` 不能导入 `core` / `agent` / `zhin` 层
- `packages/im/core` 不能导入 `packages/im/agent` 或 `zhin`
- 插件不能直接导入 `packages/im/kernel`（应通过 `@zhin.js/core`）

### 发送链路保护

所有消息发送必须通过标准链路：

```
Message.$reply / Adapter.sendMessage
  → renderSendMessage
  → root plugin before.sendMessage
  → platform Endpoint.$sendMessage
```

**禁止**：直接调用 `bot.$sendMessage()` 绕过中间件链

### 插件规范

每个插件必须包含：
- `package.json`（name, main/exports 字段）
- `src/` 目录（TypeScript 源码）
- `tests/` 目录（至少一个 `.test.ts` 文件）
- `README.md`（使用说明）

### 代码质量检查

- **ESLint** — 使用 flat config 格式（eslint.config.mjs）
- **TypeScript** — 严格模式，禁止 `any` 类型
- **导入路径** — 必须使用 `.js` 扩展名
- **AsyncLocalStorage** — `usePlugin()` 必须在模块顶层调用

### 例外处理

如果确实需要绕过某个检查：
1. 在代码中添加 `// harness-disable-next-line` 注释
2. 在 PR 描述中说明理由
3. 获得至少一位维护者审批

## Important Paths

| What | Where |
|------|-------|
| Plugin/Command/Middleware | `packages/im/core/src/plugin.ts` |
| Adapter and send chain | `packages/im/core/src/adapter.ts` |
| Message dispatcher | `packages/im/core/src/built/dispatcher.ts` |
| Agent orchestrator | `packages/im/agent/src/orchestrator/` |
| Agent dispatcher | `packages/im/agent/src/orchestrator/agent-dispatcher.ts` |
| Security policies | `packages/im/agent/src/security/` |
| Sandbox environment | `packages/im/agent/src/security/sandbox.ts` |
| Prompt builder | `packages/im/agent/src/zhin-agent/prompt-builder.ts` |
| AI providers | `packages/im/ai/src/providers/` |
| Architecture docs index | `docs/architecture/README.md` |
| Architecture overview | `docs/architecture-overview.md` |
| Repo structure | `docs/contributing/repo-structure.md` |
| Harness engineering | `docs/contributing/harness-engineering.md` |
| Agent harness engineering | `docs/advanced/agent-harness-engineering.md` |

## Guardrails

These rules are non-negotiable — violating them will break the project:

1. **Never bypass the send chain** — All outbound messages must flow through `Message.$reply` or `Adapter.sendMessage` → `renderSendMessage` → `before.sendMessage` → platform Endpoint.
2. **Respect the dependency direction** — `basic → kernel → ai → core → agent → zhin`. Lower layers must never import from higher layers.
3. **`usePlugin()` at module top-level only** — Never inside async functions, callbacks, or lazy init paths (AsyncLocalStorage context will be lost).
4. **`getPlugin()` at plugin init only** — Capture `plugin`/`root` when registering middleware, commands, tools, and events; never call `getPlugin()` inside those runtime callbacks (common production failure mode).
4. **Use `.js` extensions in imports** — TypeScript local imports require `.js` suffix (`import { x } from './y.js'`).
5. **Build order matters** — When building incrementally, follow: logger/schema/database → kernel → ai → core → agent → zhin.
6. **No git submodules** — This is a pnpm workspace monorepo; all packages live under `basic/`, `packages/`, `plugins/`, or `examples/`.
