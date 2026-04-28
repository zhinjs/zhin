---
name: dingtalk
platforms:
  - dingtalk
description: >-
  钉钉平台管理能力。当用户在钉钉中请求群管理（踢人、改群名、查群信息）、
  组织架构查询（部门/用户查询）、发送工作通知、创建或管理群聊时使用。
  即使用户没有提到钉钉，只要上下文是钉钉/DingTalk 场景且涉及群管理、
  组织架构或工作通知，就应触发。仅有昵称时先查部门用户列表获取 user_id。
keywords:
  - dingtalk
  - 钉钉
  - adapter:dingtalk
  - 群管理
  - 部门
  - 工作通知
  - 组织架构
  - 企业
  - list_members
tags:
  - group
  - management
  - im
  - enterprise
tools:
  - dingtalk_get_user
  - dingtalk_get_dept_users
  - dingtalk_list_departments
  - dingtalk_send_work_notice
  - dingtalk_create_chat
  - dingtalk_add_chat_members
  - dingtalk_dept_info
  - dingtalk_update_chat
  - dingtalk_kick_member
  - dingtalk_set_group_name
  - dingtalk_get_group_info
---

# 钉钉群聊与组织管理技能

钉钉是企业 IM 平台，特有组织架构（部门树）和工作通知能力，区别于个人社交类 IM。

## 核心原则

### 组织架构是核心

钉钉的用户隶属于部门树，很多操作需要从组织架构出发：
```
dingtalk_list_departments → 获取部门列表（根部门 ID=1）
dingtalk_get_dept_users(dept_id) → 获取部门下的用户列表
dingtalk_get_user(user_id) → 获取用户详情
```

### 工作通知 ≠ 群消息

`dingtalk_send_work_notice` 是直接发给个人的企业通知，出现在钉钉的「工作通知」入口，不需要群聊。用户说「通知一下张三」，如果是正式的企业通知，用 `send_work_notice`；如果只是聊天消息，用普通消息发送。

## 工具分类

### 群聊管理

| 工具 | 用途 | 说明 |
|------|------|------|
| `dingtalk_kick_member` | 踢出成员 | — |
| `dingtalk_set_group_name` | 改群名 | — |
| `dingtalk_get_group_info` | 群信息 | — |
| `dingtalk_create_chat` | 创建群聊 | 需群主 userId + 至少一个成员 |
| `dingtalk_add_chat_members` | 添加成员 | — |
| `dingtalk_update_chat` | 更新群设置 | 改名、换群主、增减成员 |

### 组织架构

| 工具 | 用途 | 说明 |
|------|------|------|
| `dingtalk_list_departments` | 部门列表 | 默认从根部门 ID=1 开始 |
| `dingtalk_dept_info` | 部门详情 | — |
| `dingtalk_get_dept_users` | 部门用户列表 | — |
| `dingtalk_get_user` | 用户详情 | — |

### 通知

| 工具 | 用途 | 说明 |
|------|------|------|
| `dingtalk_send_work_notice` | 工作通知 | 发给指定用户列表，不需要群 |

## 易错点

1. **部门查询从根部门 ID=1 开始**。不知道部门 ID 时先 `list_departments` 获取整棵部门树。
2. **群聊创建需要群主 userId 和至少一个成员**，不能创建空群。
3. **工作通知是独立于群聊的**，它发到个人的钉钉「工作通知」入口，不要与群消息混淆。
4. **操作成员需要钉钉 userId**，仅有昵称时先通过 `get_dept_users` 或 `get_group_info` 查找。
