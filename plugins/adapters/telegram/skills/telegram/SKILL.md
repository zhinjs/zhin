---
name: telegram
description: Telegram 群组管理：群管（踢人、解封、禁言、设管理员、改群名/描述）、置顶、投票、表情反应、贴纸、群权限设置、邀请链接、管理员列表。仅有用户名时请先 list_members 获取 user_id。
keywords:
  - telegram
  - tg
  - adapter:telegram
  - 群管理
  - 置顶
  - 投票
  - 反应
  - 贴纸
  - 权限
  - list_members
tags:
  - group
  - management
  - im
tools:
  # 平台特有工具
  - telegram_pin_message
  - telegram_unpin_message
  - telegram_list_admins
  - telegram_member_count
  - telegram_create_invite
  - telegram_send_poll
  - telegram_react
  - telegram_send_sticker
  - telegram_set_permissions
  - telegram_set_description
  # 通用群管工具
  - telegram_kick_member
  - telegram_unban_member
  - telegram_mute_member
  - telegram_set_admin
  - telegram_set_group_name
  - telegram_get_group_info
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `telegram_pin_message` | 置顶消息 | group_admin |
| `telegram_unpin_message` | 取消置顶 | group_admin |
| `telegram_list_admins` | 获取管理员列表 | user |
| `telegram_member_count` | 获取群组成员数量 | user |
| `telegram_create_invite` | 创建邀请链接 | group_admin |
| `telegram_send_poll` | 发起投票 | user |
| `telegram_react` | 对消息添加表情反应 | user |
| `telegram_send_sticker` | 发送贴纸 | user |
| `telegram_set_permissions` | 设置群权限 | group_admin |
| `telegram_set_description` | 设置群描述 | group_admin |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `telegram_kick_member` | 踢出成员 | group_admin |
| `telegram_unban_member` | 解除封禁 | group_admin |
| `telegram_mute_member` | 禁言成员 | group_admin |
| `telegram_set_admin` | 设置/取消管理员 | group_admin |
| `telegram_set_group_name` | 修改群名称 | group_admin |
| `telegram_get_group_info` | 获取群信息 | user |

## 执行规则

1. 仅有用户名时先 `telegram_list_admins` 或通过消息上下文获取 user_id
2. 禁言 duration 单位为秒，0 表示永久限制
3. 投票支持匿名和多选模式
4. 权限设置影响所有普通成员，管理员不受限
