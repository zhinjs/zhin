---
'@zhin.js/agent': patch
---

Remove ambient mutable Schedule state from the Agent turn context. Schedule authority now flows explicitly through the existing Context, Prompt, and Tool pipelines, while Schedule feedback events publish their job identity directly from TaskExecutor instead of mirroring it through legacy plugin-event ALS.
