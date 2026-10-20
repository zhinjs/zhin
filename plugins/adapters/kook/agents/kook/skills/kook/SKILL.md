---
name: kook
platforms: [kook]
description: KOOK 角色和黑名单管理能力。
keywords: [kook, role, 角色, blacklist, 黑名单]
tags: [adapter, community]
tools:
  - grant_role
  - revoke_role
  - list_roles
  - create_role
  - delete_role
  - blacklist
---

# KOOK

角色操作前先用 `list_roles` 确认角色 ID，再授予、撤销、创建或删除角色。`blacklist` 是黑名单操作，影响用户重新加入服务器，执行前应确认目标用户和意图。

当前 Agent Tool 不提供普通踢人、改昵称或成员列表查询，不要用黑名单代替普通踢人。
