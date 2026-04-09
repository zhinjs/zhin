---
name: icqq
platforms:
  - icqq
description: ICQQ（QQ 协议）群管理：踢人、禁言、全员禁言、设管理员、改名片、头衔、群公告、戳一戳、点赞、群文件等。仅有昵称时请先 list_members 查 QQ 号。
keywords:
  - ICQQ
  - QQ
  - adapter:icqq
  - 群管理
  - 踢人
  - 禁言
  - 管理员
  - 头衔
  - 群公告
  - 戳一戳
  - list_members
tags:
  - group
  - management
  - im
tools:
  # 平台特有工具
  - icqq_set_title
  - icqq_announce
  - icqq_poke
  - icqq_list_muted
  - icqq_send_user_like
  - icqq_set_anonymous
  - icqq_group_files
  - icqq_friend_list
  # 通用群管工具
  - icqq_kick_member
  - icqq_mute_member
  - icqq_mute_all
  - icqq_set_admin
  - icqq_set_nickname
  - icqq_set_group_name
  - icqq_list_members
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `icqq_set_title` | 设置群头衔 | group_admin |
| `icqq_announce` | 发送群公告 | group_admin |
| `icqq_poke` | 戳一戳互动 | user |
| `icqq_list_muted` | 查询禁言列表 | user |
| `icqq_send_user_like` | 给用户点赞 | user |
| `icqq_set_anonymous` | 开启/关闭匿名聊天 | group_admin |
| `icqq_group_files` | 获取群文件列表 | user |
| `icqq_friend_list` | 获取好友列表 | user |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `icqq_kick_member` | 踢出成员 | group_admin |
| `icqq_mute_member` | 禁言成员（duration=0 解除） | group_admin |
| `icqq_mute_all` | 全员禁言/解除 | group_admin |
| `icqq_set_admin` | 设置/取消管理员 | group_owner |
| `icqq_set_nickname` | 修改群昵称/名片 | group_admin |
| `icqq_set_group_name` | 修改群名称 | group_admin |
| `icqq_list_members` | 获取群成员列表 | user |

## 执行规则

1. 仅有成员昵称时先 `icqq_list_members` 获取 QQ 号
2. 禁言 duration 单位为秒，默认 600（10 分钟），设为 0 解除禁言
3. 头衔设置需要群主权限
4. 群公告仅管理员可发布
