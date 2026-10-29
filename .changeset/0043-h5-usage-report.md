---
"@zhin.js/cli": patch
---

ADR 0043 §6: add `zhin usage report`, a read-only ledger over `data/agent-traces/*.jsonl`. Per day it prints turns, model calls, calls-per-turn and per-call input p50/p90/max, cache-read share, history / fixed / user prompt shares, turns that hit the iteration limit and the top 5 sessions by input tokens (`--days`, `--since`, `--until`, `--session`, `--json`, `--dir`). Files are streamed line by line, malformed lines are counted, nothing is written.
