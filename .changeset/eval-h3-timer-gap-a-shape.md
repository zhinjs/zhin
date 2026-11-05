---
"@zhin.js/agent": patch
---

Eval-only (ADR 0048 H3): rewrite the four still-skipped `harness-timer-*` cases onto the Gap A `kind: 'timer'` inbound shape (`timerId`, `content`, required `owner`). They stay skipped until PR-3 wires timer Mail delivery; no runtime change.
