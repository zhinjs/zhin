---
name: telegram
platforms: [telegram]
description: Telegram 置顶、管理员查询、邀请、投票、反应、贴纸和群权限设置能力。
keywords: [telegram, pin, admin, invite, poll, reaction, sticker, permissions]
tags: [adapter, community]
tools:
  - pin_message
  - unpin_message
  - list_admins
  - member_count
  - create_invite
  - send_poll
  - react
  - send_sticker
  - set_permissions
  - set_description
---

# Telegram

使用当前聊天上下文执行操作。管理动作前可用 `list_admins` 和 `member_count` 核对群状态；邀请使用 `create_invite`；互动使用投票、reaction 或 sticker；`set_permissions` 和 `set_description` 会改变群设置，应遵守 Tool 审批策略。

当前 Agent Tool 不提供踢人、封禁、禁言、设置管理员或改群名能力。
