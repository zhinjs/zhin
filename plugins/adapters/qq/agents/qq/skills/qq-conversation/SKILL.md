---
name: qq-conversation
platforms:
  - qq
description: 查询当前 QQ 群或频道信息、机器人自身身份（群主／管理员／成员）以及当前会话支持的操作和官方限制。
keywords:
  - 当前群
  - 当前频道
  - 你是管理员吗
  - 群主
  - 机器人权限
  - 身份
tools:
  - conversation_info
---
# qq-conversation

Use `conversation_info` before claiming the bot's role or available platform permissions. Group roles come live from the official `bot_state` API for the current endpoint, not from the sender's role. A failed lookup is not evidence that the bot is an ordinary member.

Caller roles authorize a request; bot platform roles determine whether QQ can execute it. They are independent, and a successful inspection does not replace the live check each management tool performs.

In guilds the bot role is read from its guild member record (4 owner, 2 admin, 5 child-channel admin). A `channel_admin` record does not say which child channels it governs, so it cannot authorize an operation in the current channel.

The official QQ Bot API has no merged forward, poke, profile like, leave group, group announcement, essence, special title, anonymous, group files or group sign-in. Do not promise or simulate them.
