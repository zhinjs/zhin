# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **See also**: `AGENTS.md` for the universal agent entry point; `.github/copilot-instructions.md` for detailed API patterns and plugin examples.

## Project Overview

Zhin.js is a TypeScript chatbot framework — AI-driven, plugin-based, hot-reload, multi-platform. ESM-only (`"type": "module"`), targets Node.js ^20.19.0 || >=22.12.0.

## Commands

```bash
pnpm build              # Full build (Turborepo: basic/ → packages/ → plugins/)
pnpm test               # Run all Vitest tests
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report
pnpm lint               # ESLint (.ts,.tsx)
pnpm type-check         # tsc --noEmit -p tsconfig.typecheck.json
pnpm dev                # Start test-bot (examples/test-bot) with hot-reload
pnpm clean              # Clean all lib/ dist/ directories

# Bootstrap (first-time or after clean)
pnpm prepare:logger     # Build @zhin.js/logger + install CLI deps
pnpm prepare:cli        # Build scaffold-wizard + CLI + reinstall

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
- `pnpm check:use-plugin-top-level` — 检测 usePlugin() 是否在模块顶层调用
- `pnpm check:get-plugin-runtime` — 检测 getPlugin() 是否在运行时回调中调用
- `pnpm check:all` — 运行所有 harness 检查

## Architecture

Monorepo managed with **pnpm 9.0.2 workspaces** + **Turborepo** (`turbo.json`). Versioning via **Changesets**.

Build pipeline (`turbo.json`): `build` depends on `^build` (topological), outputs `lib/**` and `dist/**`. `test` depends on `build`. `type-check` depends on `^build`.

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

**禁止的导入**：kernel 不能导入 ai/core/agent/zhin；ai 不能导入 core/agent/zhin；core 不能导入 agent/zhin；插件不能直接导入 kernel（应通过 `@zhin.js/core`）。

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

`Message.$reply` / `Adapter.sendMessage` → `renderSendMessage` → root plugin `before.sendMessage` → platform `Endpoint`. No parallel `Plugin#sendMessage` bypass.

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

`pnpm type-check` uses a separate `tsconfig.typecheck.json` with explicit path aliases and limited scope (`basic/*/src` + `packages/im/*/src` only).

## Testing

**Vitest 4.x** with globals enabled (no need to import `describe`, `it`, `expect`).

Key config (`vitest.config.ts`):
- Environment: `node`
- Isolation: `false` locally, `true` in CI (avoids `vi.spyOn` leakage across files)
- Timeout: 10s
- Test pattern: `**/*.test.ts`
- Excludes: `**/lib/**`, `**/packages/toolkit/satori/**`
- Coverage thresholds: lines 45%, branches 35%
- Setup file sets `process.env.NODE_ENV = 'test'` and `L4_SKIP_PLATFORM=1`

## Key Conventions

- **Import paths**: Use `.js` extensions for TS files (`import { foo } from './bar.js'`)
- **TypeScript**: Strict mode, ES2022 target, ESNext modules, bundler resolution, decorators enabled
- **JSX**: Plugins use `jsx: "react-jsx"` with `jsxImportSource: "zhin.js"` (not React)
- **Type augmentation**: Extend `zhin.js` module for custom contexts, adapters, models
- **Workspace filtering**: `pnpm --filter <package-name>` for targeted commands

## CI

GitHub Actions (`ci.yml`): Install → changeset check → build → type-check → lint → 15+ harness checks → test+coverage → codecov. Runs on PR to `main`, Node.js 24, ubuntu-latest, 15-min timeout.

Publish workflow (`publish.yml`): On push to `main`, auto-bumps versions via Changesets and publishes to npm.

## Harness Engineering

详细文档请参考：
- [Harness Engineering 指南](docs/contributing/harness-engineering.md) — 项目级 harness engineering
- [Agent Harness Engineering 指南](docs/advanced/agent-harness-engineering.md) — Agent 安全策略

### 核心原则

1. **架构约束优先** — 通过自动化检查强制执行架构边界
2. **早期发现** — 在 CI 中捕获问题，而非生产环境
3. **明确规范** — 所有约束必须文档化并可验证
4. **最小化例外** — 任何绕过检查都需要明确的理由和审批

### Agent 安全策略

Agent harness engineering 提供多层安全防护：执行策略（5 层防御）、文件策略（4 层防御）、网络策略（域名白名单、私有 IP 阻止）、预算限制、审计日志、沙箱环境。

### 架构层级检查

项目依赖层级必须严格遵守（详见上述依赖层级图）。`pnpm check:architecture` 自动验证。

### 插件规范

每个插件必须包含：`package.json`（name, main/exports）、`src/`、`tests/`（至少一个 `.test.ts`）、`README.md`。

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
| Plugin/package instructions | `.github/instructions/zhin-plugin.instructions.md`, `zhin-packages.instructions.md` |

## Guardrails

These rules are non-negotiable — violating them will break the project:

1. **Never bypass the send chain** — All outbound messages must flow through `Message.$reply` or `Adapter.sendMessage` → `renderSendMessage` → `before.sendMessage` → platform Endpoint.
2. **Respect the dependency direction** — `basic → kernel → ai → core → agent → zhin`. Lower layers must never import from higher layers.
3. **`usePlugin()` at module top-level only** — Never inside async functions, callbacks, or lazy init paths (AsyncLocalStorage context will be lost).
4. **`getPlugin()` at plugin init only** — Capture `plugin`/`root` when registering middleware, commands, tools, and events; never call `getPlugin()` inside those runtime callbacks (common production failure mode).
5. **Use `.js` extensions in imports** — TypeScript local imports require `.js` suffix (`import { x } from './y.js'`).
6. **Build order matters** — When building incrementally, follow: logger/schema/database → kernel → ai → core → agent → zhin.
7. **No git submodules** — This is a pnpm workspace monorepo; all packages live under `basic/`, `packages/`, `plugins/`, or `examples/`.
