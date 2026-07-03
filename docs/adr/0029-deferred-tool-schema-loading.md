# ADR 0029: Deferred Tool Schema Loading

## Status

Accepted

## Context

Agent tool catalogs can exceed practical LLM context limits when every tool schema is sent on each turn. ADR 0024 retired the Worker `tool_search` / `run_deferred_task` orchestration path but left full-schema exposure in the main turn pipeline.

## Decision

1. **Always deferred** — every turn exposes only `alwaysLoadedTools` + session-loaded tools to the model (Harness path). Catalog remains full for discovery.
2. **Harness meta tools** — `discover(kind)` + `load_tool` + `load_skill` (replaces `activate_skill`).
3. **Session stickiness** — loaded tool names stored in `ContextRepository` session metadata with LRU (`maxLoadedPerSession`, default 12).
4. **Anthropic native** — when `sdk === 'anthropic'`, send full catalog with `deferLoading` on non-loaded tools and enable `advanced-tool-use-2025-11-20` beta.
5. **Config** — `ai.agent.deferredTools.alwaysLoadedTools` replaces `orchestratorTools` (auto-migrated by `fix-ai-config`).
6. **Subagents** — no `discover`; `spawn_task.tools[]` / `skills[]` declare needs; subagents may `load_tool` / `load_skill`.

## Consequences

- Breaking: `activate_skill` removed (use `load_skill`).
- Breaking: `orchestratorTools` → `deferredTools.alwaysLoadedTools`.
- `tool-selection` TF-IDF filtering bypassed for runtime catalog; discovery uses TF-IDF via `discover`.

## Related

- ADR 0024 — prior orchestration retirement
- `docs/advanced/ai.md` — Deferred Tools section
