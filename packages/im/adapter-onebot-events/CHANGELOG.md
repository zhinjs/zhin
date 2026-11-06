# @zhin.js/adapter-onebot-events

## 0.0.3

### Patch Changes

- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/core@1.1.58
  - @zhin.js/adapter@1.1.30

## 0.0.2

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/core@1.1.57
  - @zhin.js/adapter@1.1.29

## 0.0.1

### Patch Changes

- b249e5e: ADR 0044 C4：事件映射迁出 core。新增 `@zhin.js/adapter-onebot-events`，承载 OneBot v11 / NapCat / icqq 的原始通知与请求 → 标准事件映射（`receiveOneBotLikeSideEvent`、`mapNoticeParts`、`mapRequestParts`、`resolveSideEventDedupeKey` 及 OneBot 映射表，icqq 差异用覆盖表表达）；KOOK、Slack 的映射迁入各自适配器；`@zhin.js/core` 只保留标准事件名、类型与 `buildNotice` / `buildRequest` / `buildSystem` / `senderFromId`，不再含任何平台名。core 不再导出上述映射函数与 `ONEBOT_/KOOK_/SLACK_NOTICE_PARTS_MAP`、`SideEventPlatform`、`OneBotLike*` 类型，适配器改从共享包导入。
- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [aaa93d7]
- Updated dependencies [4fe49b5]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/core@1.1.56
  - @zhin.js/adapter@1.1.28
