---
'@zhin.js/agent': patch
'@zhin.js/ai': patch
'@zhin.js/runtime': patch
'@zhin.js/adapter-sandbox': patch
---

Keep interactive runtime turns and their synchronous children running without fixed iteration or total wall-clock caps. Share configured token quotas across the live turn, retain cancellation and authorization, compact child context independently, and report periodic progress without additional model calls or blocking final delivery. Scheduled, unattended, independent background and legacy API budgets remain unchanged.

Stabilize prompt prefixes by keeping conversation identity in the session-stable system tail and fresh scene state after the current message. Shorten and escape the host-context boundary, preserve permission-filtered tool disclosure, and omit fixed iteration ceilings from continuous-run traces.

Project repeated inspections of the same private image only once per model request, preserving resource access checks, transient lifetime, and the existing inspection limit.
