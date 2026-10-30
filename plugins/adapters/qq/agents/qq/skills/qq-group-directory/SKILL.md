---
name: qq-group-directory
platforms:
  - qq
description: 当前 QQ 群的群信息、成员列表与成员详情（官方白名单能力）。
keywords:
  - 群信息
  - 群成员
  - 成员列表
  - member_openid
tools:
  - group_info
  - group_members
  - group_member_info
scopes:
  - group
---
# qq-group-directory

All lookups target the current group only. Members are identified by `member_openid`, which is scoped to this bot and group; never derive it from a nickname or reuse it in another group.

Member list and member detail are invite-only official capabilities. Error 11253 means the bot has no access; report that instead of guessing. `group_members` is paged (≤30 per page, 60 QPM): request further pages only when needed.

There is no official API for the bot's group list, friend list or arbitrary user profiles, so `group_list`, `friend_list` and `user_info` do not exist on QQ official bots.
