---
name: milky
platforms:
  - milky
description: >-
  Milky 协议群管理能力。当用户在 Milky 协议的 QQ 群中请求踢人、禁言、设管理员、
  改名片/群名或查成员/群信息时使用。即使用户没有提到 Milky，只要 Bot 平台是
  Milky 协议且涉及群管理操作，就应触发。仅有昵称时必须先查成员列表获取 user_id。
keywords:
  - milky
  - adapter:milky
  - 群管理
  - 禁言
  - 踢人
  - 管理员
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

# Milky 群管理技能

Milky 是 QQ 生态中的一种协议实现，提供标准群管理工具集。

## 核心原则

### 先查后操作

只有昵称时，先 `milky_list_members` 获取 QQ 号再操作。

**Example:**
```
用户: 禁言那个叫"阿强"的
步骤1: milky_list_members → 找到 user_id = 654321
步骤2: milky_mute_member(user_id=654321, duration=600)
```

## 工具详解

| 工具 | 用途 | 权限 | 关键参数 |
|------|------|------|----------|
| `milky_kick_member` | 踢出成员 | admin | `user_id` |
| `milky_mute_member` | 禁言/解禁 | admin | `user_id`, `duration`（秒，**0=解禁**） |
| `milky_mute_all` | 全员禁言/解除 | admin | `enable` |
| `milky_set_admin` | 设/取消管理员 | owner | `user_id`, `enable` |
| `milky_set_nickname` | 改群名片 | admin | `user_id`, `nickname` |
| `milky_set_group_name` | 改群名 | admin | `name` |
| `milky_list_members` | 成员列表 | user | — |
| `milky_get_group_info` | 群信息 | user | — |

## 易错点

1. **禁言 duration=0 是解禁**，不是永久禁言。
2. **管理员设置需要群主权限**（owner），管理员无法设置其他管理员。
