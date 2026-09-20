---
name: dingtalk
platforms: [dingtalk]
description: 钉钉组织查询、工作通知和群聊创建维护能力。
keywords: [dingtalk, 钉钉, 部门, 用户, 工作通知, 群聊]
tags: [adapter, collaboration]
tools:
  - get_user
  - get_dept_users
  - list_departments
  - send_work_notice
  - create_chat
  - add_chat_members
  - dept_info
  - update_chat
---

# 钉钉

用户或部门信息不完整时，先查询再执行写操作：

1. 用 `list_departments` / `dept_info` 确认部门。
2. 用 `get_dept_users` / `get_user` 解析稳定的用户 ID。
3. 发送工作通知，或创建、更新群聊并添加成员。

不要把昵称直接当作用户 ID。当前 Agent Tool 不提供踢人、改群名或读取当前群详情能力；遇到这些请求时应明确说明能力边界。
