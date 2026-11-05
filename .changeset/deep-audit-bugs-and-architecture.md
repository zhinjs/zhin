---
"@zhin.js/schema": patch
"@zhin.js/database": patch
"@zhin.js/schedule": patch
"@zhin.js/cli": patch
"@zhin.js/im-contract": patch
"@zhin.js/adapter": patch
"@zhin.js/middleware": patch
"@zhin.js/core": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/a2a": patch
"@zhin.js/process-monitor": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-kook": patch
---

Deep audit bug fixes and 7 architectural improvements:
- Sink Agent Turn ingress pipeline from `@zhin.js/cli` into `@zhin.js/agent/runtime` (`plugin-runtime/ingress/`) and decompose `ingress-route.ts` into modular pipeline stages.
- Bind Session State Plane (`JsxButtonRegistry`, `InteractionRuntime`, `RuntimeInteractiveRouter`) to `PluginIncarnationRef` so active buttons and interactions survive unrelated-plugin HMR while expiring when the owning plugin reloads, and support per-conversation fallback numbering (`numberingScope: 'conversation'`).
- Establish `conversation_events` as the canonical message SSOT and reference `conversation_event_id`, `conversation_key`, `platform_message_id`, and `message_key` in `agent_messages` (`AGENT_MESSAGE_QUERY_VERSION = 2`), threading `conversationSequence` across inbound and outbound delivery receipts.
- Push down `DatabaseContextRepository` and `DatabaseScheduleJobStorage` full-session/full-table memory scans to indexed SQL queries.
- Add kernel-level inbound `replyTo` and `mentioned` auto-promotion (`promoteInboundMessagePayload`) plus reusable `InboundDeduper` and `TtlLookupCache` primitives in `@zhin.js/adapter`.
- Add `MiddlewareContext.dispatch` (`InboundDispatchSummary`) and `onAfterDispatch` hooks for `after-dispatch` middlewares, and support incremental rendering of in-place `envelope.payload` array mutations in `OutboundDeliveryRuntime`.
- Unify `HistoryWindowTracker` and `AgentCompactionRuntime` token/message budgets (`resolveUnifiedHistoryAndCompactionBudget`).
- Fix schema validation, database transaction connection cleanup and SQLite WAL mode, schedule timer wheel head-of-line blocking, security policy bash read paths and subagent guard propagation, group merge window permission carrier handoff, micro-compact namespaced tool matching, and WebSocket force-close / inbound segment mapping across adapters.
