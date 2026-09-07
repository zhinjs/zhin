---
"@zhin.js/adapter-slack": patch
---

Require a platform message timestamp for each Slack message chunk instead of fabricating a successful receipt. Stop subsequent chunks when delivery cannot be confirmed, and propagate file upload failures instead of silently reporting partial delivery as success.
