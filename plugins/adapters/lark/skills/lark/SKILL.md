---
name: lark
platforms:
  - lark
description: 飞书/Lark 群管理：群管（踢人、查成员/群信息、改群名）、用户查询、群聊创建/更新/解散、添加/移除管理员、文件上传。仅有昵称时请先 list_members 获取 user_id。
keywords:
  - lark
  - 飞书
  - adapter:lark
  - 群管理
  - 管理员
  - 群聊
  - 文件上传
  - list_members
tags:
  - group
  - management
  - im
  - enterprise
tools:
  # 平台特有工具
  - lark_get_user
  - lark_create_chat
  - lark_update_chat
  - lark_add_members
  - lark_set_managers
  - lark_remove_managers
  - lark_dissolve_chat
  - lark_upload_file
  # 通用群管工具
  - lark_kick_member
  - lark_list_members
  - lark_get_group_info
  - lark_set_group_name
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `lark_get_user` | 获取用户信息 | user |
| `lark_create_chat` | 创建群聊 | group_admin |
| `lark_update_chat` | 更新群聊设置 | group_admin |
| `lark_add_members` | 向群聊添加成员 | group_admin |
| `lark_set_managers` | 设置管理员 | group_admin |
| `lark_remove_managers` | 移除管理员 | group_admin |
| `lark_dissolve_chat` | 解散群聊 | group_owner |
| `lark_upload_file` | 上传文件 | user |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `lark_kick_member` | 踢出成员 | group_admin |
| `lark_list_members` | 获取成员列表 | user |
| `lark_get_group_info` | 获取群信息 | user |
| `lark_set_group_name` | 修改群名称 | group_admin |

## 执行规则

1. 仅有昵称时先 `lark_list_members` 或 `lark_get_user` 获取用户 ID
2. 群聊创建需要至少指定群名和初始成员
3. 解散群聊操作不可逆，需要群主权限
4. 文件上传会返回文件 key，可用于消息中引用
