---
"@zhin.js/harness": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0048 H3 PR-2: every IM / ZhinAgent turn is a Mail turn of a long-lived host Mailbox. Same-session admission (#725), the ADR 0038 merge / danmaku windows, stale-reply checks and supersede are now the harness inbox policy; scene-event wakes post one event Mail on the scene lane. The mid-turn delivery API is `harness.deliver` (`open` is the same call). `TurnAdmissionGate`, `InboundTurnQueue` and `harness.attach` are removed.

**Breaking config rename:** `ai.agent.inboundQueue` is now `ai.agent.mailbox` (same `groupMode` / `ttlMs` / `maxQueuedTurns` / `merge` / `live` fields; `coalesceWindowMs` is dropped). A config that still sets `ai.agent.inboundQueue` fails startup validation with a migration message.
