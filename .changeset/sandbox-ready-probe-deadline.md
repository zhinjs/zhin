---
"@zhin.js/adapter-sandbox": patch
---

Sandbox `ready` no longer waits on a hung Docker CLI: the shell-isolation probe now has a hard 750ms deadline (SIGKILL + "timed out" status) instead of relying on execFile reporting after stdio closes.
