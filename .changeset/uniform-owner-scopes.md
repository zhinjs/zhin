---
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
---

Apply the same database-table and schedule-job namespace rules to every plugin owner, including the root plugin. Remove the legacy process-host unwrapping APIs and require composition roots to provide the explicit root host tokens.
