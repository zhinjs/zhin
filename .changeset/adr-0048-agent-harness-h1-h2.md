---
"@zhin.js/harness": patch
"@zhin.js/agent": patch
"@zhin.js/agent-feature": patch
---

ADR 0048 Agent Harness (H1–H2): new `@zhin.js/harness` package (attenuated authority, conserved budgets, guard kernel, engagement journal, mailbox). Live turns now collaborate with other agents through the `agents` / `ask` / `delegate` / `tell` / `cancel_delegation` / `escalate` tools instead of `spawn_task`; `agent.json` gains `collaboration: { contacts, accepts_from }`. The sub-agent runtime, deferred workers, detached tasks and their config fields are removed.
