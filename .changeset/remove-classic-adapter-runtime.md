---
'@zhin.js/core': minor
'zhin.js': minor
---

Remove the classic Core `Adapter` class, Core `Endpoint` compatibility type, capability WeakMap, and their connection and lifecycle helpers. Platform integrations now have one model: `defineAdapter`, `Endpoint<TClient>`, and the current generation's `AdapterIndex` from `zhin.js/adapter`.
