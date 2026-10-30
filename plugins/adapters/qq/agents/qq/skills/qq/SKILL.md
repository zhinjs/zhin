---
name: qq
platforms:
  - qq
description: QQ 官方机器人频道、角色、成员详情与成员禁言／移出管理。
keywords:
  - qq
  - guild
  - channel
  - role
  - member
  - 频道禁言
  - 频道踢人
tags:
  - adapter
  - community
tools:
  - list_channels
  - list_roles
  - create_role
  - add_role
  - remove_role
  - channel_info
  - member_detail
  - guild_mute_member
  - guild_kick_member
scopes:
  - channel
---
# QQ 频道

确认频道和成员 ID 后查询详情、维护角色或处置成员；权限与审批由各 Tool 执行。可访问频道列表使用 qq-directory。

`guild_mute_member` 作用于当前频道（0 秒 = 解除），`guild_kick_member` 每次人工审批，可选拉黑和撤回近 N 天消息；机器人需具备频道管理权限，平台拒绝时不要自动重试。
