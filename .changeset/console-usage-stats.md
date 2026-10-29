---
"@zhin.js/cli": patch
---

Add the read-only Console RPC `plugin.root.usage-stats` (`control:read`) for token-usage charts: totals, per-model, per-session (top 50), a zero-filled hour/day series, context-budget segment sums and cache-hit shares, read from `data/agent-traces/*.jsonl`. The trace reading and aggregation of `zhin usage report` moved into the shared `usage/aggregate.ts` (CLI output unchanged). Ranges are capped at 31 days; results are cached in memory for 60 s (32 entries max) and never include message text.
