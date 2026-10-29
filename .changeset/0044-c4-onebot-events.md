---
"@zhin.js/adapter-onebot-events": patch
"@zhin.js/core": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-slack": patch
---

ADR 0044 C4：事件映射迁出 core。新增 `@zhin.js/adapter-onebot-events`，承载 OneBot v11 / NapCat / icqq 的原始通知与请求 → 标准事件映射（`receiveOneBotLikeSideEvent`、`mapNoticeParts`、`mapRequestParts`、`resolveSideEventDedupeKey` 及 OneBot 映射表，icqq 差异用覆盖表表达）；KOOK、Slack 的映射迁入各自适配器；`@zhin.js/core` 只保留标准事件名、类型与 `buildNotice` / `buildRequest` / `buildSystem` / `senderFromId`，不再含任何平台名。core 不再导出上述映射函数与 `ONEBOT_/KOOK_/SLACK_NOTICE_PARTS_MAP`、`SideEventPlatform`、`OneBotLike*` 类型，适配器改从共享包导入。
