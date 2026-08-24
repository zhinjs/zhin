---
"@zhin.js/agent": patch
"@zhin.js/service-activity-feedback": patch
---

Separate Adapter definitions from live Endpoint responsibilities in activity feedback. Runtime feedback now depends on a narrow outbound send port and the concrete Endpoint control surface instead of fabricating the legacy all-in-one Adapter class.
