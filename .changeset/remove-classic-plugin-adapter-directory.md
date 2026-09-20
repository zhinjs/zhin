---
'@zhin.js/core': patch
'zhin.js': patch
---

Remove the classic `Plugin.adapters` directory and `Plugin.injectAdapter()` service-locator helper. Live Endpoint discovery now belongs exclusively to the current generation's `AdapterIndex`.
