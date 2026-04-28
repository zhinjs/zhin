---
name: onebot11
platforms:
  - onebot11
description: >-
  OneBot11 协议群管理能力。当用户在 QQ 群中请求踢人、禁言、设管理员、改群名片、
  设专属头衔、查成员列表或群信息时使用此技能。即使用户没有提到 OneBot，
  只要 Bot 所在平台是 OneBot11 协议且涉及群管理操作，就应触发。
  仅有昵称时必须先查成员列表获取 user_id。
keywords:
  - onebot
  - onebot11
  - adapter:onebot11
  - 群管理
  - 头衔
  - 禁言
  - 踢人
  - 管理员
  - 群名片
  - list_members
tags:
  - group
  - management
  - im
tools:
  - onebot11_set_title
  - onebot11_kick_member
  - onebot11_mute_member
  - onebot11_mute_all
  - onebot11_set_admin
  - onebot11_set_nickname
  - onebot11_set_group_name
  - onebot11_list_members
  - onebot11_get_group_info
---

# OneBot11 群管理技能

OneBot11 是 QQ 生态中广泛使用的标准协议。此技能覆盖基础群管理操作，另有一个平台特有工具（专属头衔）。

## 核心原则

### 先查后操作

用户说「把小明禁言」，但工具需要 QQ 号。只有昵称时，第一步永远是 `onebot11_list_members` 获取成员列表，匹配到 `user_id` 后再操作。不要猜测 QQ 号。

**Example:**
```
用户: 把"小飞"踢了
步骤1: onebot11_list_members → 找到 user_id = 123456
步骤2: onebot11_kick_member(user_id=123456)
```

### 权限层级

- **user** — 查询类：`list_members`, `get_group_info`
- **group_admin** — 管理类：踢人、禁言、改名片、改群名
- **group_owner** — 仅群主：设管理员、设专属头衔

Bot 权限不足时 API 会报错，应向用户说明而非重试。

## 工具详解

| 工具 | 用途 | 权限 | 关键参数 |
|------|------|------|----------|
| `onebot11_kick_member` | 踢出成员 | admin | `user_id` |
| `onebot11_mute_member` | 禁言/解禁 | admin | `user_id`, `duration`（秒，**0=解禁**） |
| `onebot11_mute_all` | 全员禁言/解除 | admin | `enable`（true/false） |
| `onebot11_set_admin` | 设/取消管理员 | owner | `user_id`, `enable` |
| `onebot11_set_nickname` | 改群名片 | admin | `user_id`, `nickname` |
| `onebot11_set_group_name` | 改群名称 | admin | `name` |
| `onebot11_set_title` | 设专属头衔 | owner | `user_id`, `title` |
| `onebot11_list_members` | 获取成员列表 | user | — |
| `onebot11_get_group_info` | 获取群信息 | user | — |

## 易错点

1. **禁言 duration=0 是解禁**，不是永久禁言。最长可设 2592000（30 天）。
2. **头衔只有群主能设**，管理员也不行。用户说「加个头衔」但 Bot 不是群主时，告知无法操作。
3. **OneBot11 与 NapCat/ICQQ 功能范围不同**：标准 OneBot11 不支持合并转发、精华消息、群文件等扩展功能，这些属于 NapCat 或 ICQQ 的增强。
