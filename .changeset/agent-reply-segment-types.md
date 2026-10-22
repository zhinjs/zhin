---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Agent structured replies now offer only the segment types the reply endpoint delivers (derived from the adapter's `segments.supported`), and the model can send quick-reply keyboard buttons. reply / forward / face are no longer offered to the model because it has no reliable source for their platform IDs.
