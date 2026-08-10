---
'@zhin.js/adapter-dingtalk': patch
'@zhin.js/adapter-discord': patch
'@zhin.js/adapter-kook': patch
'@zhin.js/adapter-lark': patch
'@zhin.js/adapter-napcat': patch
'@zhin.js/adapter-onebot11': patch
'@zhin.js/adapter-qq': patch
'@zhin.js/adapter-slack': patch
'@zhin.js/adapter-telegram': patch
'@zhin.js/adapter-wecom': patch
'@zhin.js/service-activity-feedback': patch
---

refactor(adapters): migrate platform-permit to PermissionSubject

All adapter platform-permit checkers now accept PermissionSubject
(duck-typed from Message/CommandSession) instead of Message directly.
registerPlatformPermitChecker is replaced by host.registerPlatform in
the adapter plugin setup. activity-feedback service updated for new
PermissionHost integration.
