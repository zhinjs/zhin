---
name: kook
platforms:
  - kook
description: KOOK 服务器管理：群管（踢人、封禁、解封、改昵称、查成员）、角色管理（创建/删除/授予/撤销）、黑名单。仅昵称时请先 list_members 获取 user_id。
keywords:
  - kook
  - KOOK
  - adapter:kook
  - 群管理
  - 角色
  - 黑名单
  - list_members
tags:
  - group
  - management
  - im
tools:
  # 平台特有工具
  - kook_grant_role
  - kook_revoke_role
  - kook_list_roles
  - kook_create_role
  - kook_delete_role
  - kook_blacklist
  # 通用群管工具
  - kook_kick_member
  - kook_ban_member
  - kook_unban_member
  - kook_set_nickname
  - kook_list_members
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `kook_grant_role` | 授予角色 | group_admin |
| `kook_revoke_role` | 撤销角色 | group_admin |
| `kook_list_roles` | 获取角色列表 | user |
| `kook_create_role` | 创建角色 | group_admin |
| `kook_delete_role` | 删除角色 | group_admin |
| `kook_blacklist` | 黑名单操作 | group_admin |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `kook_kick_member` | 踢出成员 | group_admin |
| `kook_ban_member` | 封禁成员 | group_admin |
| `kook_unban_member` | 解除封禁 | group_admin |
| `kook_set_nickname` | 修改成员昵称 | group_admin |
| `kook_list_members` | 获取成员列表 | user |

## 执行规则

1. 操作成员需要 KOOK 用户 ID，仅有昵称时先调 `kook_list_members`
2. 角色操作需要角色 ID，先调 `kook_list_roles` 查询
3. 黑名单操作会永久封禁用户，需谨慎使用
