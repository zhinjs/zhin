---
"@zhin.js/kernel": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Skip the assistant-profile heartbeat while HEARTBEAT.md is missing or has no task, the way the kernel scheduler's own heartbeat already did. The default heartbeat prompt only reads that file, so each idle run was a wasted model turn (about 40k prompt tokens every 30 minutes). Heartbeats with a custom prompt still run.
