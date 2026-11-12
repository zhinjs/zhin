# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **See also**: `AGENTS.md` for the universal agent entry point; `.github/copilot-instructions.md` for detailed API patterns and plugin examples.

## Project Overview

Zhin.js is a TypeScript chatbot framework — AI-driven, plugin-based, hot-reload, multi-platform. ESM-only (`"type": "module"`), targets Node.js >=22.19.0.

## Commands

```bash
pnpm build              # Full build (Turborepo: basic/ → packages/ → plugins/)
pnpm test               # Run all Vitest tests
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report
pnpm test:e2e:gateway   # Slow process-level gateway suite (tests/e2e-gateway, after pnpm build); skipped by pnpm test, run once in full-validation.yml
pnpm lint               # ESLint (.ts,.tsx)
pnpm type-check         # tsc --noEmit -p tsconfig.typecheck.json
pnpm dev                # Start minimal-bot (examples/minimal-bot); use pnpm dev:test for test-bot
pnpm clean              # Clean all lib/ dist/ directories
pnpm eval:chat --workspace <dir> --model <profile-id> --judge <profile-id>  # Real-model chat quality eval (local, not CI); takes runtime Profile IDs

# Bootstrap (first-time or after clean)
pnpm prepare:logger     # Build @zhin.js/logger + install CLI deps
pnpm prepare:cli        # Build scaffold-wizard + CLI + reinstall

# Single package
pnpm --filter @zhin.js/core build
pnpm vitest run packages/im/core        # @zhin.js/core has no `test` script; run its tests from the root

# Run a single test file
pnpm vitest run packages/im/core/tests/ai-access.test.ts
```

Custom lint checks:
- `pnpm check:harness-paths` — 检测插件是否绕过 Adapter.sendMessage 直调 bot.$sendMessage，以及适配器 Agent 工具（`plugins/adapters/*/agents/**`）是否绕过出站端口直调平台发送接口（白名单 `scripts/agent-send-bypass-allowlist.json`）
- `pnpm check:no-koa` — 检测插件是否直接 import koa（应使用 RouterContext）
- `pnpm check:prod` — 检查生产环境配置（无 console.log/debugger/TODO/FIXME）
- `pnpm check:plugin` — 检查插件是否符合标准规范（入口文件、测试、README）
- `pnpm check:no-platform-branches` — 检测运行时代码是否出现平台名分支（应读适配器能力画像，ADR 0044；白名单 `scripts/no-platform-branches-allowlist.json`）
- `pnpm check:no-removed-plugin-api` — 检测是否重新调用已从 public surface 删除的 Plugin lookup API
- `pnpm check:plugin-capability-publish` — 带 agent/ 的插件发布清单（files、prepublishOnly）
- `pnpm check:all` — 运行所有 harness 检查（含 type-check / lint / test）

## Architecture

Monorepo managed with **pnpm 9.0.2 workspaces** + **Turborepo** (`turbo.json`). Versioning via **Changesets**.

Build pipeline (`turbo.json`): `build` depends on `^build` (topological), outputs `lib/**` and `dist/**`. `test` depends on `build`. Root `type-check` / `lint` are plain root scripts (`tsc` / `eslint`), not turbo tasks.

### Dependency layers (bottom → top)

```
basic/                      # @zhin.js/logger, schema, database, cli
  ↓
packages/im/kernel          # Scheduling, errors, identity, utilities
  ↓
packages/im/ai              # AI engine (providers, agents, memory, compaction)
  ↓
packages/im/core            # Canonical IM runtime and message contracts
  ↓
packages/im/agent           # Agent orchestration (ZhinAgent, security policies, MCP client)
  ↓
packages/im/zhin            # Main entry — IM core; agent via optional peer + zhin.js/agent
                            #   src/instance/ = instance composition root (zhin.js/instance, ADR 0054)

packages/host/gateway       # Management gateway (ADR 0054): IAM, terminal, project files; no zhin.js / IM layers
basic/cli                   # `zhin` CLI: depends on the gateway, never on IM layers

packages/console/{contract,protocol,plugin-contract,page,layout,pagemanager,client}  # 控制台栈（平行，不经 IM 发送链）
packages/toolkit/{create-zhin,components,tailwind,html-renderer}         # 脚手架与渲染库
```

**禁止的导入**：kernel 不能导入 ai/core/agent/zhin；ai 不能导入 core/agent/zhin；core 不能导入 agent/zhin；插件不能直接导入 kernel（应通过 `@zhin.js/core`）。

### Key packages at a glance

| Package | Path | Role |
|---------|------|------|
| kernel | `packages/im/kernel/src/` | ScheduleEngine, outbound template path rendering, heartbeat helper, shared utilities |
| ai | `packages/im/ai/src/` | Provider abstraction, agent loop, sessions, memory, compaction |
| core | `packages/im/core/src/` | ImRuntime, messages, side events, rendering, interaction |
| agent | `packages/im/agent/src/` | ZhinAgent orchestrator, security (ExecPolicy, FilePolicy), MCP client |
| host-http | `packages/host/http/src/` | 极简 HTTP/WS Host（Bearer、CORS，无 Koa）、Console 访问控制门禁；Console/管理面由 `zhin.js/instance` 装配 |
| gateway | `packages/host/gateway/src/` | 管理网关（ADR 0054）：Console 账号与权限（`iam/`）、终端（`terminal/`）、项目配置与 `.env`、依赖事务、实例监管；不依赖 `zhin.js` 与 IM 层 |
| instance | `packages/im/zhin/src/instance/` | Zhin 实例装配根（`zhin.js/instance`）：IM Runtime、Agent Host、运行时侧 Console 后端 |
| mcp / a2a | `packages/host/{mcp,a2a}/src/` | MCP Server、A2A Server |

### Outbound send chain (do not bypass)

`Message.$reply` / Runtime outbound port → `OutboundRenderer` → outbound middleware → platform `Endpoint`. No parallel send path.

### Console access control (ADR 0049)

- Users, roles, sessions, API tokens and the audit log live in the project database (`packages/host/gateway/src/iam/`), not in config. `http.token` is only a **bootstrap token**: valid until the first owner exists (Console wizard or `zhin console init`), refused everywhere afterwards. `http.tokens` is removed (startup fails). Automation uses user-issued API tokens via `ZHIN_CONSOLE_TOKEN`.
- Every `/api` route and every Console RPC must be listed in the permission map of `@zhin.js/console-protocol` (`CONSOLE_HTTP_PERMISSIONS`, `CONSOLE_RPC_PERMISSIONS`, `CONSOLE_WS_PERMISSIONS`); unlisted ones are denied to every signed-in principal (owners included). Register a permission whenever you add a route, RPC or host-authenticated socket.
- Plugin routes outside the Console (Webhooks, adapter reverse WebSockets) authenticate themselves: `http.ws(path, { auth: 'protocol' })` plus the plugin's own credential (`verifyProtocolAccessToken`).

### Plugin system (Plugin Runtime — current)

Start a project with **`zhin start`** (ADR 0054): it runs the management gateway (`@zhin.js/gateway`) and the gateway supervises the Zhin instance (`zhin.js/instance`). `zhin start` runs in the background by default (`zhin status` / `logs` / `stop` / `restart` reach it over `.zhin/gateway.sock`); `--foreground` attaches (production templates and `pnpm start` use it); `zhin runtime start` is an alias for `zhin start --foreground`; `--standalone` (instance with its own HTTP server, no gateway) is for tests and development only. The gateway owns the HTTP port, the project database's `console_*` tables and Console authentication (`/auth/*`, `iam.*`, terminal, audit); the instance never authenticates — it only authorizes the principal the gateway forwards. Plugins are **packages**: `package.json#zhin` declares the manifest (`entry`, `engine`, `runtime`, `features`, `plugins`), and `plugin.ts` must **default-export a `definePlugin()` definition** — `PluginScopeAssembler` throws `does not default-export a Plugin definition` otherwise.

```ts
// plugin.ts — thin wiring only
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',                      // /^[a-z][a-z0-9-]*$/
  metadata: { displayName: 'My Plugin' },
  setup(context) {
    // context.plugin / config / resources (Scope) / lifecycle / handoff
    context.resources.provide(someToken, value);
    return () => cleanup();               // or context.lifecycle.add(...)
  },
});
```

Capabilities are **discovered from convention directories**, not registered imperatively — one per file, default-exported:

| Directory | Authoring API |
|---|---|
| `commands/**/index.ts` | `defineCommand()` (`zhin.js/command`) — directory path is the route; Next.js-style param directories `[name]/` / `[[name]]/` (optional) / `[...name]/` (catch-all), type and default declared in `defineCommand({ params })` |
| `middlewares/<name>/index.ts` | `defineMiddleware()` (`zhin.js/middleware`) |
| `handlers/**/index.ts` | `defineHandler()` (`zhin.js/handler`) — path uses `/` (e.g. `handlers/message/receive/index.ts` → localName `message/receive` → event `message.receive` when `event` omitted); `this.prompt` available |
| `components/<name>/index.tsx` | `defineComponent()` (`zhin.js/component`) |
| `tools/<name>/index.ts` | `defineAgentTool()` (`@zhin.js/tool`) |
| `pages/<name>/index.tsx` | `definePage()` (`nav/index.tsx` / `footer/index.tsx` for chrome) |
| `skills/<name>/SKILL.md` | Markdown Skill package |
| `skills/<name>/tools/<name>/index.ts` | Skill-private Tool, disclosed after Skill activation |
| `agents/<name>/tools/<name>/index.ts` | Agent-private Tool |
| `agents/<name>/skills/<name>/tools/<name>/index.ts` | Agent-Skill-private Tool |
| `agents/<name>/` | `agent.json` + core Markdown sub-agent package |

DI is **Scope + Token** based (`context.resources`), generation-scoped rather than a global registry. See `.github/skills/migrate-zhin-plugin-runtime/references/migration-map.md` for the full old→new mapping.

### Removed legacy APIs (`usePlugin()` / `getPlugin()` / `bootstrapNode`)

`zhin.js/node` and `bootstrapNode` have been **deleted and are no longer exported**. The **sole entry path** is `definePlugin()` + `zhin start` (Plugin Runtime under the gateway). Do not author or call legacy plugin APIs.

### Build output

- Most packages: `src/` → `lib/` (via `tsc`)
- Browser-side packages (e.g. console client): `client/` → `dist/`
- Dual exports: `./lib/index.js` (production) + `./src/index.ts` (development condition)
- Module resolution uses `conditions: ['development']` in tests to resolve `src/` directly

### TypeScript configuration

All packages extend `tsconfig.base.json`（根目录，相对路径按包深度调整），只需设置 `outDir`、`rootDir`、`types`：

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "outDir": "./lib",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["lib", "node_modules"]
}
```

`pnpm type-check` uses a separate `tsconfig.typecheck.json` with explicit path aliases and limited scope — see its `include` list (selected `basic/` and `packages/im/` sources, examples, plugin convention directories, docs snippets and type fixtures), not every workspace package.

## Testing

**Vitest 4.x** with globals enabled (no need to import `describe`, `it`, `expect`).

Key config (`vitest.config.ts`):
- Environment: `node`
- Isolation: `true` (avoids `vi.spyOn` leakage across files)
- Timeout: 10s
- Test pattern: `**/*.test.ts`
- Excludes: `**/lib/**`
- Coverage thresholds: lines 45%, branches 35%
- Setup file sets `process.env.NODE_ENV = 'test'` and `L4_SKIP_PLATFORM=1`

## Key Conventions

- **Import paths**: Use `.js` extensions for TS files (`import { foo } from './bar.js'`)
- **TypeScript**: Strict mode, ES2022 target, ESNext modules, bundler resolution, decorators enabled
- **JSX**: Plugins use `jsx: "react-jsx"` with `jsxImportSource: "zhin.js"` (not React)
- **Type augmentation**: Extend `zhin.js` module for custom contexts, adapters, models
- **Workspace filtering**: `pnpm --filter <package-name>` for targeted commands

## CI

GitHub Actions (`ci.yml`): PR/push/merge-queue gate on `ubuntu-latest` — `plan` (affected scope) → `contracts` (source contracts + changed-file lint) → `build` → `test` (4 shards) → `checks`; 10–15 min timeouts, concurrency-cancelled per ref.

Full validation (`full-validation.yml`): nightly / manual / reusable. Matrix OS (ubuntu/windows) × Node.js (22/24/26), `fail-fast: true`, 25-min timeout. Coverage + codecov upload only on `ubuntu-latest` + Node 24.

Publish workflow (`publish.yml`): On push to `main`, auto-bumps versions via Changesets and publishes to npm.

## Harness Engineering

详细文档请参考：
- [Harness Engineering 指南](docs/contributing/development.md) — 项目级 harness engineering
- [Agent Harness Engineering 指南](docs/ai/agent.md) — Agent 安全策略

### 核心原则

1. **架构约束优先** — 通过自动化检查强制执行架构边界
2. **早期发现** — 在 CI 中捕获问题，而非生产环境
3. **明确规范** — 所有约束必须文档化并可验证
4. **最小化例外** — 任何绕过检查都需要明确的理由和审批

### Agent 安全策略

Agent harness engineering 提供多层安全防护：执行策略（5 层防御）、文件策略（4 层防御）、网络策略（域名白名单、私有 IP 阻止）、预算限制、沙箱环境。

### 架构层级检查

项目依赖层级必须严格遵守（详见上述依赖层级图）。`pnpm check:architecture` 自动验证。

### 插件规范

每个插件必须包含：`package.json`（name, main/exports）、`src/`、`tests/`（至少一个 `.test.ts`）、`README.md`。

## Important Paths

| What | Where |
|------|-------|
| Plugin definition (`definePlugin`) | `packages/im/plugin-runtime/src/plugin.ts` |
| Adapter and send chain | `packages/im/core/src/feature/adapter.ts` |
| Message dispatcher | `packages/im/core/src/plugin-runtime/im/message-dispatcher.ts` |
| Agent runtime / turn engine | `packages/im/agent/src/plugin-runtime/` (`agent-runtime.ts`, `full-agent-turn-engine.ts`) |
| Agent ingress (mailbox spine) | `packages/im/agent/src/plugin-runtime/ingress/unified-mailbox-spine.ts` |
| Security policies | `packages/im/agent/src/security/` |
| Sandbox environment | `packages/im/agent/src/security/sandbox.ts` |
| Prompt assembly | `packages/im/agent/src/prompt/system-prompt.ts`, `assembly.ts` |
| AI providers | `packages/im/ai/src/providers/` |
| Instance composition root | `packages/im/zhin/src/instance/` (`start-command.ts`, `console/`, `*-host-installer.ts`) |
| Management gateway | `packages/host/gateway/src/` (`iam/`, `terminal/`, `config/`, `plugin-management/`, `project/`, `supervisor/`) |
| Architecture docs index | `docs/concepts/architecture.md` |
| Architecture overview | `docs/concepts/architecture.md` |
| Repo structure | `docs/contributing/repo-structure.md` |
| Harness engineering | `docs/contributing/development.md` |
| Agent harness engineering | `docs/ai/agent.md` |
| Plugin agent/ authoring | `docs/authoring/agent-tools.md` |
| Plugin/package instructions | `.github/instructions/zhin-plugin.instructions.md`, `zhin-packages.instructions.md` |

## Guardrails

These rules are non-negotiable — violating them will break the project:

1. **Never bypass the send chain** — All outbound messages must flow through `Message.$reply` or `Adapter.sendMessage` → `renderSendMessage` → `before.sendMessage` → platform Endpoint.
2. **Respect the dependency direction** — `basic → kernel → ai → core → agent → zhin`. Lower layers must never import from higher layers. Exception: the Zhin instance composition root `packages/im/zhin/src/instance/` (`zhin.js/instance`, ADR 0054 §0) assembles IM/Agent/Console hosts and may import every `packages/im` layer, the protocol Hosts and the Console stack; this exception is scoped to that directory only. `@zhin.js/cli` and `@zhin.js/gateway` must not import `zhin.js` or IM layers (only `@zhin.js/plugin-runtime` contracts and `@zhin.js/runtime` config / project-file tools); the CLI resolves `zhin.js/instance` from the project at run time (`check:architecture` enforces both).
3. **`plugin.ts` must default-export `definePlugin()`** — The Plugin Runtime loader requires it; capabilities belong in convention directories (`commands/`, `middlewares/`, `tools/`, …), not in imperative top-level registration.
4. **Legacy startup is removed** — `zhin.js/node` / `bootstrapNode` and Plugin lookup APIs no longer exist; use `definePlugin()` + `zhin start` (gateway + supervised instance; `zhin runtime start` is its foreground alias) only. `check:no-removed-plugin-api` prevents their reintroduction.
5. **Use `.js` extensions in imports** — TypeScript local imports require `.js` suffix (`import { x } from './y.js'`).
6. **Build order matters** — When building incrementally, follow: logger/schema/database → kernel → ai → core → agent → zhin.
7. **No git submodules** — This is a pnpm workspace monorepo; all packages live under `basic/`, `packages/`, `plugins/`, or `examples/`.
