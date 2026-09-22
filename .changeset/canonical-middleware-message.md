---
'@zhin.js/core': patch
'zhin.js': patch
'@zhin.js/agent': patch
'@zhin.js/permission': patch
'@zhin.js/adapter-github': patch
---

Expose the canonical Plugin Runtime `Message` contract from `@zhin.js/core`, `@zhin.js/core/runtime`, and the `zhin.js` root entries, and migrate Agent, permission, and GitHub integrations to the fields middleware actually receives. Document and lock the `EndpointEvent<Notice | Request>` handler boundary so side-event payload fields match editor inference.
