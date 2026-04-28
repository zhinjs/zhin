---
name: qq
platforms:
  - qq
description: >-
  QQ 官方机器人管理能力。当用户在 QQ 官方机器人（非 OneBot/NapCat）中请求群管（踢人、
  禁言、全员禁言）、频道/子频道管理、角色管理（创建/添加/移除角色）、
  或查询成员详情时使用。即使用户没有明确提到 QQ 官方机器人，只要 Bot 平台是 qq
  （官方 API）且涉及上述操作，就应触发。仅有昵称时先 list_members 查 user_id。
keywords:
  - qq
  - QQ
  - adapter:qq
  - 群管理
  - 频道
  - 子频道
  - 角色
  - 官方机器人
  - list_members
tags:
  - group
  - management
  - im
tools:
  - qq_list_guilds
  - qq_list_channels
  - qq_list_roles
  - qq_create_role
  - qq_add_role
  - qq_remove_role
  - qq_channel_info
  - qq_member_detail
  - qq_kick_member
  - qq_mute_member
  - qq_mute_all
  - qq_list_members
  - qq_get_group_info
---

# QQ 官方机器人管理技能

QQ 官方机器人 API 同时支持「群聊」和「频道」两种场景，频道有 Guild/Channel 二级结构。

## 核心原则

### 群 vs 频道

QQ 官方机器人有两个独立的体系：
- **群聊**（Group）：传统 QQ 群，用 `group_id` 标识
- **频道**（Guild + Channel）：类似 Discord，Guild 是大频道，Channel 是子频道

操作前确认用户说的是「群」还是「频道」。

### 频道导航链

频道操作需要逐级获取 ID：
```
qq_list_guilds → 获取 guild_id
qq_list_channels(guild_id) → 获取 channel_id
qq_channel_info(channel_id) → 子频道详情
```

## 工具分类

### 群聊管理

| 工具 | 用途 | 说明 |
|------|------|------|
| `qq_kick_member` | 踢出成员 | — |
| `qq_mute_member` | 禁言 | — |
| `qq_mute_all` | 全员禁言/解除 | — |
| `qq_list_members` | 成员列表 | — |
| `qq_get_group_info` | 群信息 | — |

### 频道管理

| 工具 | 用途 | 说明 |
|------|------|------|
| `qq_list_guilds` | 频道列表 | 获取所有 Guild |
| `qq_list_channels` | 子频道列表 | 获取 Guild 下的 Channel |
| `qq_channel_info` | 子频道详情 | — |
| `qq_member_detail` | 成员详情 | — |

### 角色管理

| 工具 | 用途 | 说明 |
|------|------|------|
| `qq_create_role` | 创建角色 | — |
| `qq_add_role` | 授予角色 | 需 role_id |
| `qq_remove_role` | 移除角色 | 需 role_id |
| `qq_list_roles` | 角色列表 | 获取所有角色及 ID |

## 易错点

1. **频道操作需要 guild_id + channel_id 二级 ID**，不能只用一个。先 `list_guilds` 再 `list_channels`。
2. **角色操作需要 role_id**，先 `qq_list_roles` 查询。
3. **此适配器是 QQ 官方 API**，功能受限于官方开放的接口，不如 NapCat/ICQQ 灵活。
