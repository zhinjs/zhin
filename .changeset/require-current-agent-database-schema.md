---
"@zhin.js/agent": minor
"zhin.js": minor
---

Require the current Agent session database models during generation activation and remove automatic SQLite schema probing, legacy-column deletion, and historical session-tree backfills. Database mode now rejects incomplete schema registration instead of silently retaining in-memory session state.
