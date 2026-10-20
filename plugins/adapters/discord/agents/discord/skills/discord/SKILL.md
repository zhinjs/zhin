---
name: discord
platforms: [discord]
description: Discord 角色、线程、论坛帖子、反应和 Embed 操作能力。
keywords: [discord, role, thread, forum, reaction, embed]
tags: [adapter, community]
tools:
  - add_role
  - remove_role
  - list_roles
  - create_thread
  - react
  - send_embed
  - forum_post
---

# Discord

按“先查询、后修改”执行：授予或移除角色前先用 `list_roles` 找到角色 ID；创建线程或论坛帖子时使用当前频道上下文；发送结构化内容时使用 `send_embed`；表情回应使用 `react`。

当前 Agent Tool 不提供踢人、封禁、禁言、改昵称或成员列表操作，不要声称已经执行这些动作。
