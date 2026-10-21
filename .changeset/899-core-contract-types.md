---
"@zhin.js/core": patch
"zhin.js": patch
---

Re-export the `ConversationRef`, `DeliveryReceipt`, `CapabilityContext` and `OperationClientPort` types from `@zhin.js/core` and `zhin.js`, so toolkits such as `@zhin.js/testing` can type against the app's single `zhin.js` tree instead of depending on `@zhin.js/im-contract` and `@zhin.js/feature-kit` directly (#899). Type-only and additive.
