---
name: group-admin
description: 群管理增强：入群欢迎、关键词自动回复、撤回提醒、群公告发送。
keywords:
  - group
  - admin
  - 群管理
  - welcome
  - 欢迎
  - keyword
  - 关键词
  - reply
  - 回复
  - recall
  - 撤回
  - announce
  - 公告
tags:
  - group
  - management
  - admin
tools:
  - group_announce
---

## 工具概览

| 工具 | 说明 |
|------|------|
| `group_announce` | 发送群公告 |

## 执行规则

- 入群欢迎：监听 `group_member_increase` 事件自动发送
- 关键词回复：通过命令管理关键词触发规则，中间件匹配消息
- 撤回提醒：监听 `group_recall` 事件通知群内
- 群公告通过 AI 工具 `group_announce` 调用
