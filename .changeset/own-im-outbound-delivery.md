---
"@zhin.js/core": patch
"@zhin.js/cli": patch
---

Move rendering, outbound policy projection, middleware execution, Endpoint delivery, conversation recording, and observer publication into one `OutboundDeliveryRuntime`. Replace the flat `ImRuntime.onMessage()` method with a read-only `messageEvents` subscription source and narrow Console message and Inbox dependencies to explicit ports.
