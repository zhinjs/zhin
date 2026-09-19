---
'@zhin.js/core': minor
'@zhin.js/agent': minor
'zhin.js': minor
---

Remove dead deprecated aliases from Core and Agent, including legacy Tool and outbound segment types, the old interactive segment helper, duplicate Session and Schedule names, obsolete log formatters, and the process-global Task Executor drain shim. Current APIs now expose one name and one ownership model for each behavior.
