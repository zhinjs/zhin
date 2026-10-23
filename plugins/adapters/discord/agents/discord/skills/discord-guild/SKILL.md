---
name: discord-guild
platforms:
  - discord
scopes:
  - channel
description: Discord 服务器角色、频道线程与论坛帖子。
keywords:
  - discord
  - role
  - thread
  - forum
tools:
  - add_role
  - remove_role
  - list_roles
  - create_thread
  - forum_post
---
# discord-guild

角色修改前用 list_roles 确认角色 ID；线程和帖子使用当前频道上下文。遵守权限和审批。没有踢人、封禁、禁言、改昵称或成员列表工具，不要声称已执行这些动作。
