---
name: milky
description: Milky 协议群管理：踢人、禁言、全员禁言、设管理员、改昵称/群名、查成员/群信息。
keywords:
  - milky
  - adapter:milky
  - 群管理
  - list_members
tags:
  - group
  - management
  - im
tools:
  - milky_kick_member
  - milky_mute_member
  - milky_mute_all
  - milky_set_admin
  - milky_set_nickname
  - milky_set_group_name
  - milky_list_members
  - milky_get_group_info
---

## 工具概览

| 工具 | 说明 | 权限 |
|------|------|------|
| `milky_kick_member` | 踢出成员 | group_admin |
| `milky_mute_member` | 禁言成员（duration=0 解除） | group_admin |
| `milky_mute_all` | 全员禁言/解除 | group_admin |
| `milky_set_admin` | 设置/取消管理员 | group_owner |
| `milky_set_nickname` | 修改群昵称/名片 | group_admin |
| `milky_set_group_name` | 修改群名称 | group_admin |
| `milky_list_members` | 获取群成员列表 | user |
| `milky_get_group_info` | 获取群信息 | user |

## 执行规则

1. 仅有昵称时先 `milky_list_members` 获取用户 QQ 号
2. 禁言 duration 单位为秒，默认 600（10 分钟），设为 0 解除
3. 管理员设置需要群主权限
