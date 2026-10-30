---
name: qq-group-admin
platforms:
  - qq
description: QQ 官方机器人群管理：移出成员、禁言、撤回他人消息、处理入群申请；工具分别声明权限与审批要求。
keywords:
  - 群管理
  - 禁言
  - 踢人
  - 移出
  - 入群申请
  - 撤回他人消息
tools:
  - group_kick
  - set_mute
  - recall_member_message
  - handle_join_request
scopes:
  - group
  - channel
---
# qq-group-admin

Load only when the current group and target member are explicit. Every tool targets the current conversation; the model cannot choose another group. Each tool re-checks the bot's live role (`bot_state`) before acting.

Official limits (enforced by QQ, not by this skill): the bot must be group owner/admin; only ordinary members (not owner, admins or bots) can be removed or muted; mute is at most 30 days; recall works only within 2 minutes; member removal and join-request APIs are invite-only (11253 = no access).

`group_kick` and `handle_join_request` need a fresh human approval each time; show the target member and the reason. A previous approval never authorizes the next action. `set_mute` always needs approval.

Automatic moderation needs a confirmed rule and target group; never invent trigger conditions from permissions alone.

`recall_member_message` keeps the master/admin/trusted/owner requester permission without per-call approval and also works in guild channels (platform-enforced admin rights). To recall the bot's own message, use `qq-messages`.

Not available on official bots: invite to group, leave group, special title, anonymous, announcement, essence, poke and group sign-in.
