---
name: telegram-chat-admin
platforms:
  - telegram
description: Telegram 管理员查询、成员数、邀请、置顶和群权限设置能力。
keywords:
  - "telegram"
  - "admin"
  - "invite"
  - "pin"
  - "permissions"
tools:
  - "pin_message"
  - "unpin_message"
  - "list_admins"
  - "member_count"
  - "create_invite"
  - "set_permissions"
  - "set_description"
---

# telegram-chat-admin

先读取管理员与成员状态，再执行邀请、置顶或权限变更。群设置写操作遵守审批策略。
