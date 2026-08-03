---
"@zhin.js/cli": patch
"@zhin.js/game-kit": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-wecom": patch
---

fix: QQ 适配器群聊误识别为私聊、game-kit 启动崩溃、全面补齐 recallMessage

- fix(cli): `resolveChannelType` 增加 `metadata.channelKind` 检查，修复 QQ/Discord/KOOK 群聊消息被误分类为私聊
- fix(game-kit): `createHostGameDb` 改用延迟代理模型，避免数据库启动前解析模型导致崩溃
- feat(qq): 实现 `recallMessage`，解析复合 messageId 路由到对应 SDK 撤回方法；`normalizeQqMessage` 增加 `message_type` 缺失时的回退检测
- feat(slack): 实现 `recallMessage`，利用已有 compound ref 和 `chat.delete` API
- feat(onebot11): 两个 endpoint 类实现 `recallMessage`（`delete_msg`）
- feat(onebot12): 两个 endpoint 类实现 `recallMessage`（`delete_message`）
- feat(napcat): 三个 endpoint 类实现 `recallMessage`（`delete_msg`）
- feat(discord): 两个 endpoint 类实现 `recallMessage`；`send()` 改为返回 `channelId:snowflake` 复合 ID
- feat(telegram): 实现 `recallMessage`（`deleteMessage`）；`send()` 改为返回 `chatId:messageId` 复合 ID
- feat(kook): 两个 endpoint 类实现 `recallMessage`，利用 kook-client `recallMsg` API
- feat(lark): 实现 `recallMessage`（`DELETE /im/v1/messages/{id}`）
- feat(wecom): 实现 `recallMessage`（`POST /cgi-bin/message/recall`）
