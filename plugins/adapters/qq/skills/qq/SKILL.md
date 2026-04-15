---
name: qq
platforms:
  - qq
description: QQ 官方机器人管理：群管（踢人、禁言、全员禁言、查成员/群信息）、频道/子频道管理、角色管理（创建/添加/移除）、成员详情。仅有昵称时请先 list_members 查 user_id。
keywords:
  - qq
  - QQ
  - adapter:qq
  - 群管理
  - 频道
  - 角色
  - list_members
tags:
  - group
  - management
  - im
tools:
  # 平台特有工具
  - qq_list_guilds
  - qq_list_channels
  - qq_list_roles
  - qq_create_role
  - qq_add_role
  - qq_remove_role
  - qq_channel_info
  - qq_member_detail
  # 通用群管工具
  - qq_kick_member
  - qq_mute_member
  - qq_mute_all
  - qq_list_members
  - qq_get_group_info
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `qq_list_guilds` | 获取频道列表 | user |
| `qq_list_channels` | 获取子频道列表 | user |
| `qq_list_roles` | 获取角色列表 | user |
| `qq_create_role` | 创建角色 | group_admin |
| `qq_add_role` | 为成员添加角色 | group_admin |
| `qq_remove_role` | 移除成员角色 | group_admin |
| `qq_channel_info` | 获取子频道详情 | user |
| `qq_member_detail` | 获取成员详情 | user |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `qq_kick_member` | 踢出成员 | group_admin |
| `qq_mute_member` | 禁言成员 | group_admin |
| `qq_mute_all` | 全员禁言/解除 | group_admin |
| `qq_list_members` | 获取群成员列表 | user |
| `qq_get_group_info` | 获取群信息 | user |

## 执行规则

1. 仅有昵称时先 `qq_list_members` 获取用户 ID
2. 频道操作需要 guild_id 和 channel_id，先 `qq_list_guilds` → `qq_list_channels`
3. 角色操作需要 role_id，先 `qq_list_roles` 查询
