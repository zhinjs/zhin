# Public API Surface

This checklist is the SSOT (single source of truth) for determining whether an API is public or internal. The goal: a maintainer can make a judgment on any symbol within 10 minutes without reading the implementation.

Three tiers:

| Tier | Label | Meaning |
|------|-------|---------|
| Stable Public | `stable` / `experimental` | User-facing authoring surface, commits to semver (`experimental` may be adjusted in minor releases, with prior notice in the changelog) |
| Internal | `internal` | Framework internals. Readable and debuggable, but **no guarantee against breaking changes** -- may change in any version |
| Deprecated | `deprecated` | Migrated/no longer recommended. Kept for compatibility for one minor cycle then removed |

> Annotation location: source JSDoc (`@public` / `@internal`) should be annotated in entry files first; this checklist is the complete list. When they conflict, this checklist takes precedence and a PR should be filed to correct the source.

## Stable Public (semver commitment)

### define\* Authoring Functions

> App authors should import from **`zhin.js/*` facade subpaths** (depending on `zhin.js` is enough). The "Implementation package" column is the Feature provider / `platformFeatures` mount name — **do not** separately `pnpm add` those packages.

| API | Stability | Author import | Implementation | One-liner |
|-----|-----------|---------------|----------------|-----------|
| `definePlugin` | `stable` | `zhin.js` | `@zhin.js/plugin-runtime` | Convention-based plugin entry, default export from `plugin.ts` |
| `defineCommand` | `stable` | `zhin.js/command` | `@zhin.js/command` | Command module (default export in `commands/`) |
| `defineAdapter` | `stable` | `zhin.js/adapter` | `@zhin.js/adapter` | Adapter module (default export in `adapters/`), `create(context)` returns an Endpoint |
| `defineComponent` | `stable` | `zhin.js/component` | `@zhin.js/component` | Satori/SSR component (default export in `components/`) |
| `defineMiddleware` | `stable` | `zhin.js/middleware` | `@zhin.js/middleware` | Middleware module (default export in `middlewares/`) |
| `defineHandler` | `stable` | `zhin.js/handler` | `@zhin.js/handler` | Lifecycle event handler (default export in `handlers/`; `/` → `.` event inference) |
| `defineAgentTool` | `experimental` | `@zhin.js/tool` (`tools/`); `zhin.js/agent` (`agent/tools/*.ts`) | `@zhin.js/tool` | AI tool module, auto-discovered by Agent |

> Note: **There is no `defineAgentSkill`**. Agent skills are pure Markdown (`agent/skills/*.md`, parsed by `parseSkillMarkdown` from `@zhin.js/skill`), not code symbols.

### Convention Directories and Files

| Convention | Stability | Consumer | One-liner |
|------------|-----------|----------|-----------|
| `plugin.ts` | `stable` | `zhin.js` | Plugin root entry, default exports `definePlugin(...)` |
| `commands/` | `stable` | `@zhin.js/command` (author import: `zhin.js/command`) | Command module directory, supports `[name]` / `[[name]]` / `[...name]` dynamic parameter segments |
| `adapters/` | `stable` | `@zhin.js/adapter` (author import: `zhin.js/adapter`) | Adapter module directory |
| `middlewares/` | `stable` | `@zhin.js/middleware` (author import: `zhin.js/middleware`) | Middleware module directory |
| `handlers/` | `stable` | `@zhin.js/handler` (author import: `zhin.js/handler`) | Lifecycle event handler directory (`/` localName segments; omit `event` → `.` event; runtime currently wires `message.receive`) |
| `tools/` | `experimental` | `@zhin.js/tool` | Agent tool directory (`defineAgentTool`) |
| `agent/tools` | `experimental` | `zhin.js/agent` authoring | File-based Agent tool authoring surface |
| `agent/skills` | `experimental` | `@zhin.js/skill` / Agent discovery | Agent skill Markdown (published with npm packages) |
| `pages/` | `experimental` | `@zhin.js/console-page` | Console page module directory |

### Host Tokens (consumed via `context.resources.use(token)`)

| Token | Stability | Source Package | One-liner |
|-------|-----------|----------------|-----------|
| `databaseHostToken` | `stable` | `zhin.js` | Database Host capability |
| `scheduleHostToken` | `stable` | `zhin.js` | Scheduled task Host capability |
| `outboundHostToken` | `stable` | `zhin.js` | Cross-platform outbound message capability |
| `messageGatewayToken` | `stable` | `@zhin.js/core` (`zhin.js/core/runtime`) | Inbound message delivery gateway (used by adapters) |
| `httpHostToken` | `stable` | `@zhin.js/host-http` | HTTP/WS Host capability (used by Console, Webhooks) |

### Removed Legacy Hooks

| API | Stability | Source Package | One-liner |
|-----|-----------|----------------|-----------|
| `usePlugin()` and associated hooks (`provide` / `addCommand` / `useContext`, etc.) | `deprecated` (see table below) | `zhin.js` (`@zhin.js/core`) | Legacy plugin system entry, still compatible; new code uses convention-based approach |
| `MessageCommand` / `CommandFeature` | `deprecated` | `zhin.js` (`@zhin.js/core`) | Classic commands; new code uses `defineCommand` + `commands/` |
| `bootstrapNode` / `zhin.js/node` | `removed` | none (subpath deleted) | The only startup entry is `zhin runtime start` |

### `zhin.config.yml` Top-Level Keys

| Key | Stability | Consumer | One-liner |
|-----|-----------|----------|-----------|
| `plugins.<key>` | `stable` | `@zhin.js/cli` assembly layer | Plugin enablement and plugin-level config |
| `endpoints[i]` | `stable` | `@zhin.js/cli` assembly layer | Adapter instance list (includes `master` / `trusted` / `commandPrefix`) |
| `commandPrefix` | `stable` | `MessageDispatcher` | Command prefix, top-level instance + per-endpoint override |
| `ai` | `stable` | `@zhin.js/cli` AI Host assembly | AI/Agent configuration |
| `http` | `stable` | `@zhin.js/host-http` assembly | HTTP Host configuration |
| `database` | `stable` | database Host assembly | Database configuration |
| `speech` | `stable` | speech Host assembly | Speech configuration |
| `log_level` | `stable` | `@zhin.js/cli` | Log level (`ZHIN_LOG_LEVEL` can override) |

> Other Host-level keys (`mcp` / `a2a` / `htmlRenderer` / `assistant`) are also stable top-level keys; see [Configuration Overview](../configuration/index.md) for the complete table.

### CLI Commands

| Command | Stability | Source Package | One-liner |
|---------|-----------|----------------|-----------|
| `zhin runtime start` | `stable` | `@zhin.js/cli` | Plugin Runtime entry point (composition root) |
| `zhin setup` | `stable` | `@zhin.js/cli` | Incremental configuration wizard for existing projects |
| `zhin doctor` | `stable` | `@zhin.js/cli` | Environment/config health check |
| `pnpm create zhin-app` | `stable` | `create-zhin-app` | New project scaffold |

## Internal (Readable but No Stability Guarantee)

| API | Stability | Source Package | One-liner |
|-----|-----------|----------------|-----------|
| `RootRuntime` / `RootController` | `internal` | `@zhin.js/plugin-runtime` | Root controller for plugin tree and generations |
| `CapabilitySlot` | `internal` | `@zhin.js/plugin-runtime` | Capability slot, carrier between features and projections |
| `SnapshotStore` / `RuntimeSnapshot` | `internal` | `@zhin.js/plugin-runtime` | Atomic snapshot store, input for projections |
| `AdapterIndex` | `internal` | `@zhin.js/adapter` | Adapter projection, snapshot -> Endpoint assembly |
| `CommandIndex` | `internal` | `@zhin.js/command` | Command projection, snapshot -> command routing table |
| `ToolIndex` / `SkillIndex` / `McpIndex` / `PageIndex` / `LayoutIndex`, etc. | `internal` | Various feature packages | Other projections, all internal mechanisms |
| `defineFeatureProvider` (Feature Provider protocol) | `internal` | `@zhin.js/feature-kit` | Protocol for adding new feature types, aimed at framework extenders, not plugin authors |
| `MessageDispatcher` | `internal` | `@zhin.js/core` | Message dispatcher (`createMessageDispatcher` for assembly, routing strategy is configurable) |
| `basic/cli/src/plugin-runtime/*-installer.ts` | `internal` | `@zhin.js/cli` | Root Host installers (database / schedule / outbound / inbox / http / console / agent / speech / html-renderer / protocol); assembly details may change at any time |

## Deprecated / Migrated

| Item | Stability | Status | One-liner |
|------|-----------|--------|-----------|
| Legacy `usePlugin()` plugin system | `deprecated` | Kept for compatibility, runtime still supports it | New code uses convention-based approach (`plugin.ts` + convention directories); deletion countdown begins after dual-track migration is complete |
| `MessageCommand` / classic `CommandFeature` | `deprecated` | Still used by Agent init / game-kit hub | Will be removed after migration to `defineCommand` + Runtime `CommandIndex` |
| `bootstrapNode` / `zhin.js/node` | `removed` | No longer exported | Use `zhin runtime start` |
| "Host plugin" narrative | `deprecated` | Documentation has been consolidated | Host capabilities are now token-based (see Host Token table above), no longer a plugin concept |
| `examples/test-bot` as a user path | `deprecated` | Maintainer kitchen sink | User paths are minimal-bot (Stable) -> full-bot (L4); do not use test-bot config as a template |
| `plugin.yml` plugin manifest | `deprecated` | Legacy `Plugin` and `zhin build` still read it (`packages/im/core/src/plugin.ts`, `basic/cli/src/libs/plugin-package-build.ts`) | Part of the legacy system, will be retired along with it; convention-based plugins use `package.json` as the source of truth |

## Decision Rules (Which Tier for New APIs)

Ask three questions in order:

1. **Is this something a plugin author/user would write directly?** (define\* functions, convention directories, config keys, CLI commands, Host tokens)
   -> Yes: default to **Stable Public**. AI/Console and other surfaces that haven't converged yet should be labeled `experimental` first, then promoted to `stable` after convergence.
2. **Is this a mechanism in the snapshot -> projection -> assembly pipeline?** (`*Index`, `SnapshotStore`, `CapabilitySlot`, installer, dispatcher, Feature Provider protocol)
   -> Yes: default to **Internal**. Internal mechanisms do not become public just because they are exported (for cross-package reuse).
3. **Removing/replacing an existing public API?**
   -> First label `deprecated` (JSDoc `@deprecated` + move in this checklist + note in changelog), **keep for at least one minor cycle** before removal; removal itself is a breaking change, handled via major bump or per the repo's release conventions.

Fallback: when in doubt, treat it as **Internal** -- promoting from internal to public does not break anyone; the reverse is a breaking change.

Related docs: [Code Conventions](./conventions.md), [Development Workflow & CI Gates](./development.md), [Plugin Model](../concepts/plugin-model.md).
