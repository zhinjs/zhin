---
"@zhin.js/adapter-discord": patch
---

Project Discord Gateway readiness from the connected client's live readiness state so runtime health no longer reports an observed ready connection as offline. Loss of readiness and stop remain offline.

Enable partial DM channels so the SDK admits messages from private channels that have not yet been cached.
