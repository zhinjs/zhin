---
name: qq
platforms: [qq]
description: QQ 官方机器人频道、角色和成员详情能力。
keywords: [qq, guild, channel, role, member]
tags: [adapter, community]
tools:
  - list_guilds
  - list_channels
  - list_roles
  - create_role
  - add_role
  - remove_role
  - channel_info
  - member_detail
---

# QQ 官方机器人

先用 `list_guilds` 和 `list_channels` 确认频道上下文。角色操作前用 `list_roles` 获取角色 ID；成员操作前用 `member_detail` 确认目标。创建、授予和移除角色属于写操作，应遵守对应 Tool 的审批策略。

当前 Agent Tool 不提供群踢人、禁言或成员列表能力。
