---
name: dingtalk
platforms:
  - dingtalk
description: 钉钉用户、部门查询、工作通知与创建群聊。
keywords:
  - dingtalk
  - 钉钉
  - 部门
  - 用户
  - 工作通知
  - 群聊
tags:
  - adapter
  - collaboration
tools:
  - get_user
  - get_dept_users
  - list_departments
  - send_work_notice
  - create_chat
  - dept_info
---
# 钉钉

先用 list_departments / dept_info 查询部门，用 get_dept_users / get_user 取得稳定用户 ID，再发送工作通知或创建群聊。不要把昵称当作 ID。
