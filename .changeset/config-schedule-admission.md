---
"@zhin.js/config-file": patch
"@zhin.js/schedule": patch
---

Serialize commits and rollbacks within each config document so concurrent transactions cannot both overwrite the same revision. Reserve scheduled jobs before asynchronous store claims, reject late claims after cancellation, pause or shutdown, and report claim failures through the scheduler error callback.
