---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/logger": patch
"@zhin.js/cli": patch
"zhin.js": patch
---

Move optional Speech loading and pipeline ownership into the CLI composition root. Agent media handling now depends on an explicitly injected `AudioTranscriptionPort`; Core no longer exposes a process-global Speech loader, and Logger no longer exposes the process-global warn-once registry.
