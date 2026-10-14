---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Add a minimal per-turn trace: `TurnTrace` collector (model calls and tokens, redacted tool-call summaries with duration and result size, denials, budget extensions and auto-continuations, nested sub-agent turns, termination) fed from the turn journal, the last 50 traces kept in `data/agent-traces/recent.json`, a new `zhin trace <turnId|last>` command, and traces attached to failing eval reports.
