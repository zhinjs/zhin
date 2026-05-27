# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
pnpm vitest run packages/core/tests/plugin.test.ts
```

Custom lint checks: `pnpm check:harness-paths`, `pnpm check:no-koa`, `pnpm check:prod`, `pnpm check:plugin`.

## Architecture

Monorepo managed with **pnpm 9.0.2 workspaces** (no Turborepo). Versioning via **Changesets**.

### Dependency layers (bottom → top)

```
basic/                  # @zhin.js/logger, schema, database, cli
  ↓
packages/kernel         # Runtime kernel (no IM concepts)
  ↓
packages/ai             # AI engine (providers, agents, memory, compaction)
  ↓
packages/core           # IM framework (Plugin, Adapter, Bot, Command, MessageDispatcher)
  ↓
packages/agent          # Agent orchestration (ZhinAgent, security policies, MCP client)
  ↓
packages/zhin           # Main entry — re-exports core + agent
```

Parallel to IM stack: `packages/queue-runtime` (queue-based bot runtime, depends on kernel, not core).

### Key packages at a glance

| Package | Path | Role |
|---------|------|------|
| kernel | `packages/kernel/src/` | PluginBase, Feature, Cron, Scheduler, error hierarchy |
| ai | `packages/ai/src/` | Provider abstraction, Agent, ModelRegistry, Memory, Compaction, CostTracker |
| core | `packages/core/src/` | Plugin (AsyncLocalStorage), Adapter, Bot, Command, MessageDispatcher |
| agent | `packages/agent/src/` | ZhinAgent orchestrator, security (ExecPolicy, FilePolicy), MCP client |
| http-host | `packages/http-host/src/` | HTTP routing abstraction (Koa-based) |
| queue-runtime | `packages/queue-runtime/src/` | Queue bot runner, dual-queue architecture |

### Outbound send chain (do not bypass)

IM stack: `Message.$reply` / `Adapter.sendMessage` → `renderSendMessage` → root plugin `before.sendMessage` → platform `Bot`. All outbound must go through this chain — no parallel `Plugin#sendMessage` bypass.

Queue stack: `enqueueOutgoing` → `claimOutgoing` → `executeOutbound`. Separate from IM chain.

### Plugin system

Uses **AsyncLocalStorage** for context management. `usePlugin()` must be called at module top-level (not inside async functions). Plugins auto-mount on `start()`, unmount on `stop()`.

Context/DI: `provide()` registers, `inject()` / `useContext()` consumes. Return a cleanup function from `useContext` callback for lifecycle management.

### Build output

- Most packages: `src/` → `lib/` (via `tsc`)
- Client package: `src/` → `dist/`
- Dual exports: `./lib/index.js` (production) + `./src/index.ts` (development condition)
- Module resolution uses `conditions: ['development']` in tests to resolve `src/` directly

## Testing

**Vitest 3.2.4** with globals enabled (no need to import `describe`, `it`, `expect`).

Key config (`vitest.config.ts`):
- Environment: `node`
- Isolation: `false` (shared state for performance)
- Timeout: 10s
- Test pattern: `**/*.test.ts`
- Excludes: `**/lib/**`, `**/packages/satori/**`
- Setup file sets `process.env.NODE_ENV = 'test'`

## Key Conventions

- **Import paths**: Use `.js` extensions for TS files (`import { foo } from './bar.js'`)
- **TypeScript**: Strict mode, ES2022 target, ESNext modules, bundler resolution, decorators enabled
- **JSX**: Plugins use `jsx: "react-jsx"` with `jsxImportSource: "zhin.js"` (not React)
- **Type augmentation**: Extend `zhin.js` module for custom contexts, adapters, models
- **Workspace filtering**: `pnpm --filter <package-name>` for targeted commands

## CI

GitHub Actions (`ci.yml`): Install → changeset check → build → harness checks → test → coverage. Runs on PR to `main`, Node.js 24, ubuntu-latest, 15-min timeout.

Publish workflow (`publish.yml`): On push to `main`, auto-bumps versions via Changesets and publishes to npm.

## Important Paths

| What | Where |
|------|-------|
| Plugin/Command/Middleware | `packages/core/src/plugin.ts` |
| Adapter and send chain | `packages/core/src/adapter.ts` |
| Message dispatcher | `packages/core/src/built/dispatcher.ts` |
| Agent orchestrator | `packages/agent/src/orchestrator/` |
| Security policies | `packages/agent/src/security/` |
| AI providers | `packages/ai/src/providers/` |
| Queue bot runner | `packages/queue-runtime/src/runner.ts` |
| Architecture docs | `docs/architecture-overview.md` |
| Repo structure | `docs/contributing/repo-structure.md` |
