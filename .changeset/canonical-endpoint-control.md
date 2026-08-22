---
"@zhin.js/im-contract": patch
"@zhin.js/core": patch
"@zhin.js/adapter": patch
"@zhin.js/cli": patch
"@zhin.js/service-activity-feedback": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-icqq": patch
---

Remove legacy compound-string message targets and Endpoint control probing. Endpoint control and outbound Host operations now carry structured `MessageRef` identities. Endpoint send has one exact result contract (a platform message id), which IM Runtime projects into `DeliveryReceipt.message`; arbitrary result guessing is removed.
