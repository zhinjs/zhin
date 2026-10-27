---
name: icqq-conversation
platforms:
  - icqq
description: 查询当前群或频道信息、机器人自身身份（群主／管理员／成员）以及当前会话支持的操作和权限边界。
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
# icqq-conversation

Use `conversation_info` before claiming the bot's role or available platform permissions. It uses the current endpoint account, not the sender's role. Group roles are refreshed from the platform on demand; failure is not evidence that the bot is an ordinary member.

Caller roles authorize a request; bot platform roles determine whether QQ can execute it. They are independent. A successful inspection does not replace the live permission check before a management action.

Guild member lookup can be incomplete. Missing self membership means `unknown`. A `channel_admin` record does not identify which child channels it governs, so it cannot authorize an operation in the current channel.

Load `icqq-messages` for quote/forward/own-message recall, or `icqq-group-admin` for member-message recall and leaving the current group. These operations are unavailable in the current guild-channel integration. Do not infer capability from a group role or substitute a group API for a channel API.
