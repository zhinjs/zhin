---
'@zhin.js/agent': major
'@zhin.js/cli': patch
---

Replace Message-keyed deferred tool state with a turn-owned deferred controller. Deferred meta tools are now created by the Agent turn, concurrent turns and subagents receive isolated state, and the legacy WeakMap binding API has been removed.
