---
name: dingtalk
description: 钉钉平台管理：群管理（踢人、改群名、查群信息）、组织架构（部门/用户查询）、工作通知、群聊创建与管理。仅有昵称时请先 list_members 获取 user_id 再操作。
keywords:
  - dingtalk
  - 钉钉
  - adapter:dingtalk
  - 群管理
  - 部门
  - 工作通知
  - 组织架构
  - list_members
tags:
  - group
  - management
  - im
  - enterprise
tools:
  # 平台特有工具
  - dingtalk_get_user
  - dingtalk_get_dept_users
  - dingtalk_list_departments
  - dingtalk_send_work_notice
  - dingtalk_create_chat
  - dingtalk_add_chat_members
  - dingtalk_dept_info
  - dingtalk_update_chat
  # 通用群管工具
  - dingtalk_kick_member
  - dingtalk_set_group_name
  - dingtalk_get_group_info
---

## 工具概览

### 平台特有

| 工具 | 说明 | 权限 |
|------|------|------|
| `dingtalk_get_user` | 获取用户信息 | user |
| `dingtalk_get_dept_users` | 获取部门用户列表 | user |
| `dingtalk_list_departments` | 获取部门列表 | user |
| `dingtalk_dept_info` | 获取部门详细信息 | user |
| `dingtalk_send_work_notice` | 发送工作通知 | group_admin |
| `dingtalk_create_chat` | 创建群聊 | group_admin |
| `dingtalk_add_chat_members` | 向群聊添加成员 | group_admin |
| `dingtalk_update_chat` | 更新群聊设置（改名、换群主、增减成员） | group_admin |

### 通用群管

| 工具 | 说明 | 权限 |
|------|------|------|
| `dingtalk_kick_member` | 踢出成员 | group_admin |
| `dingtalk_set_group_name` | 修改群名称 | group_admin |
| `dingtalk_get_group_info` | 获取群信息 | user |

## 执行规则

1. 操作成员时需要 `user_id`，仅有昵称时先调 `dingtalk_get_dept_users` 或 `dingtalk_get_group_info` 获取
2. 部门查询默认从根部门 ID=1 开始
3. 群聊创建需要群主 userId 和至少一个成员
4. 工作通知发送给指定用户列表，不依赖群聊
