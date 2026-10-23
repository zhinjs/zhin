---
name: telegram-chat-admin
platforms:
  - telegram
description: Telegram 群组或频道管理员查询、成员数、邀请、置顶和描述管理。
keywords:
  - telegram
  - admin
  - invite
  - pin
tools:
  - pin_message
  - unpin_message
  - list_admins
  - member_count
  - create_invite
  - set_description
scopes:
  - group
  - channel
---
# Telegram 群组与频道

先读取管理员与成员状态，再执行邀请、置顶或描述变更；遵守各 Tool 的审批。群默认成员权限使用 telegram-group-permissions。
