---
'@zhin.js/core': patch
'@zhin.js/agent': patch
'zhin.js': patch
---

Remove the deleted `usePlugin`, `getPlugin`, and host-root registry signatures
from the public runtime instead of retaining throwing or no-op compatibility
exports. Remove the module-global `registerAIHook` compatibility registry;
Agent hooks now belong to generation-owned resources and canonical stream events.
