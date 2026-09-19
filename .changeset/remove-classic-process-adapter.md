---
'@zhin.js/core': minor
'zhin.js': minor
---

Remove the unmounted classic `ProcessAdapter`, `ProcessEndpoint`, and process stdin runtime helpers. Local interaction is owned by the Sandbox Adapter and CLI Host, so Core no longer exposes a second process-global transport path.
