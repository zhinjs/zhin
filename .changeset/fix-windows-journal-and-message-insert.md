---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
---

Skip unsupported directory handle flushes on Windows while retaining file flushes and POSIX directory durability, and prevent Agent message persistence from issuing a second insert when a SQL dialect does not return an inserted id.
