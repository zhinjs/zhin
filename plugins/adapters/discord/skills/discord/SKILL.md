---
name: discord
description: Discord 服务器管理：群管（踢人、封禁、解封、禁言、改昵称、查成员）、角色管理、帖子/论坛、表情反应、Embed 消息、线程创建。需先 list_members 获取用户 ID。
keywords:
  - discord
  - adapter:discord
  - 群管理
  - 踢人
  - 禁言
  - 封禁
  - 角色
  - 线程
  - embed
  - 反应
  - list_members
tags:
  - group
  - management
  - im
tools:
  # 平台特有工具
  - discord_add_role
  - discord_remove_role
  - discord_list_roles
  - discord_create_thread
  - discord_react
  - discord_send_embed
  - discord_forum_post
  # 通用群管工具
  - discord_kick_member
  - discord_ban_member
  - discord_unban_member
  - discord_mute_member
  - discord_set_nickname
  - discord_list_members
  - discord_get_group_info
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `discord_add_role` | 为成员添加角色 | group_admin |
| `discord_remove_role` | 移除成员角色 | group_admin |
| `discord_list_roles` | 获取服务器角色列表 | user |
| `discord_create_thread` | 创建线程 | user |
| `discord_react` | 对消息添加表情反应 | user |
| `discord_send_embed` | 发送 Embed 富文本消息 | user |
| `discord_forum_post` | 在论坛频道创建帖子 | user |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `discord_kick_member` | 踢出成员 | group_admin |
| `discord_ban_member` | 封禁成员 | group_admin |
| `discord_unban_member` | 解除封禁 | group_admin |
| `discord_mute_member` | 禁言成员 | group_admin |
| `discord_set_nickname` | 修改成员昵称 | group_admin |
| `discord_list_members` | 获取成员列表 | user |
| `discord_get_group_info` | 获取服务器/频道信息 | user |

## 执行规则

1. 操作成员需要 Discord 用户 ID，仅有昵称时先调 `discord_list_members`
2. 角色操作需要角色 ID，先调 `discord_list_roles` 查询
3. Embed 消息支持 title/description/color/fields 等字段
4. 仅 Gateway 连接的 Bot 支持全部功能
