---
'@zhin.js/agent': patch
---

Own the Agent lifecycle event contract inside the Agent package and remove the
classic Plugin event subscription bridges. Runtime consumers now subscribe
through explicit event targets instead of Plugin AsyncLocalStorage.
