---
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/host-http": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Sink runtime, HTTP, IM, database, inference, and agent host installers from `@zhin.js/cli` into their owning runtime packages (`@zhin.js/runtime`, `@zhin.js/host-http`, `@zhin.js/core/runtime`, `@zhin.js/agent/runtime`), extract the canonical `executeInboundTurnSpine` with `InboundTurnRecord` in `@zhin.js/core/runtime`, and unify `ZhinAgent.hostMailbox`, `AgentTurnIngressRoute`, and `EngagementJournal` onto a single Actor/Mailbox runtime spine.
