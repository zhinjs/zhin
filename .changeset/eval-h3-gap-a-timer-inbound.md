---
"@zhin.js/agent": patch
---

Eval framework only (ADR 0048 H3 Gap A): `EvalInbound` is now a discriminated union with a `kind: 'timer'` inbound (`timerId`, `content`, required `owner`, optional `target`), validated by `validateEvalCase`. The driver throws a stable "timer Mail inbound not supported" error for timer inbound until timer Mail delivery is wired; H3 cases stay skipped.
