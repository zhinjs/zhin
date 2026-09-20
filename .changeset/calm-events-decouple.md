---
'@zhin.js/agent': patch
'@zhin.js/core': patch
'@zhin.js/cli': patch
'@zhin.js/service-activity-feedback': patch
'zhin.js': patch
---

Own the Agent lifecycle event contract inside the Agent package and remove the
classic Plugin event subscription bridges. Runtime consumers now subscribe
through explicit event targets instead of Plugin AsyncLocalStorage. Agent event
publication no longer double-writes into `Plugin.dispatch()`, and Core no longer
declares Agent or Schedule events in `Plugin.Lifecycle`. Replace the process-global
activity bus with a generation-owned Resource, and remove concrete Plugin objects
from ZhinAgent and its tool security path.
