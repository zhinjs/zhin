---
name: onebot11
description: OneBot11 协议群管理：踢人、禁言、全员禁言、设管理员、改昵称/群名、头衔、查成员/群信息。仅有昵称时请先 list_members 获取 user_id。
keywords:
  - onebot
  - onebot11
  - adapter:onebot11
  - 群管理
  - 头衔
  - list_members
tags:
  - group
  - management
  - im
tools:
  # 平台特有工具
  - onebot11_set_title
  # 通用群管工具
  - onebot11_kick_member
  - onebot11_mute_member
  - onebot11_mute_all
  - onebot11_set_admin
  - onebot11_set_nickname
  - onebot11_set_group_name
  - onebot11_list_members
  - onebot11_get_group_info
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `onebot11_set_title` | 设置群头衔 | group_owner |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `onebot11_kick_member` | 踢出成员 | group_admin |
| `onebot11_mute_member` | 禁言成员（duration=0 解除） | group_admin |
| `onebot11_mute_all` | 全员禁言/解除 | group_admin |
| `onebot11_set_admin` | 设置/取消管理员 | group_owner |
| `onebot11_set_nickname` | 修改群昵称/名片 | group_admin |
| `onebot11_set_group_name` | 修改群名称 | group_admin |
| `onebot11_list_members` | 获取群成员列表 | user |
| `onebot11_get_group_info` | 获取群信息 | user |

## 执行规则

1. 仅有昵称时先 `onebot11_list_members` 获取用户 QQ 号
2. 禁言 duration 单位为秒，默认 600（10 分钟），设为 0 解除
3. 头衔设置需要群主权限
4. OneBot11 与 ICQQ 功能类似，但底层协议不同
