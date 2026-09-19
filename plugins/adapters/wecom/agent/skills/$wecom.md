---
name: wecom
platforms:
  - wecom
description: >-
  企业微信平台管理能力。当用户在企业微信中请求用户信息查询、部门架构查询、
  发送文本消息时使用。即使用户没有提到企业微信，只要上下文是企业微信/WeCom
  场景且涉及用户查询、部门管理或消息发送，就应触发。
keywords:
  - wecom
  - 企业微信
  - adapter:wecom
  - 部门
  - 用户
  - 通讯录
  - 企业
tags:
  - im
  - enterprise
tools:
  - wecom_get_user
  - wecom_get_dept_users
  - wecom_list_departments
  - wecom_send_text
---

# 企业微信技能

企业微信（WeCom）是腾讯面向企业的 IM 平台，具备组织架构（部门树）、应用消息推送等能力。

## 核心原则

### 组织架构是核心

企业微信的用户隶属于部门树，查询操作需要从组织架构出发：
```
wecom_list_departments → 获取部门列表（默认从根部门 ID=1 开始）
wecom_get_dept_users(dept_id) → 获取部门下的用户列表
wecom_get_user(user_id) → 获取用户详情
```

### 消息发送

`wecom_send_text` 通过应用消息接口发送文本消息，需要知道接收者的 `userid`。
群消息通过 webhook 回调自动处理，不需要主动调用发送工具。

## 工具分类

### 组织架构

| 工具 | 用途 | 说明 |
|------|------|------|
| `wecom_list_departments` | 部门列表 | 默认从根部门 ID=1 开始 |
| `wecom_get_dept_users` | 部门用户列表 | 返回简单用户信息 |
| `wecom_get_user` | 用户详情 | 需要通讯录权限 |

### 消息

| 工具 | 用途 | 说明 |
|------|------|------|
| `wecom_send_text` | 发送文本消息 | 发给指定用户，通过应用消息接口 |

## 易错点

1. **部门查询从根部门 ID=1 开始**。不知道部门 ID 时先 `list_departments` 获取整棵部门树。
2. **消息发送需要 userid**，不是用户名或昵称。仅有昵称时先通过 `get_dept_users` 查找。
3. **企业微信不支持机器人撤回消息**，一旦发出无法撤回。
4. **Access Token 有效期 7200 秒**，适配器会自动刷新。
