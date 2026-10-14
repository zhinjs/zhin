---
"@zhin.js/agent": patch
"@zhin.js/client": patch
"@zhin.js/cli": patch
---

Agent turn traces are now persisted in `data/agent-traces/<day>.jsonl`, kept for 7 days with a 64 MB size cap (`ZHIN_TRACE_RETENTION_DAYS`, `ZHIN_TRACE_MAX_MB`), and redacted again when written. `zhin trace` can filter by session and time (`--sessions`, `--session`, `--since`, `--until`). A new read-only host API (`/api/agent/trace-archive/*`, full scope) backs the Console Agent Trace page (`TraceArchivePage`), which goes from sessions to turns to a turn detail with a waterfall and the raw record. Failing agent evals print a `zhin trace` command that opens the failing case's trace (#728).
