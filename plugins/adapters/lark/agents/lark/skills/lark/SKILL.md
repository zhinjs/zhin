---
name: lark
platforms: [lark]
description: 飞书用户查询、群聊生命周期、管理员和文件上传能力。
keywords: [lark, 飞书, user, chat, manager, file]
tags: [adapter, collaboration]
tools:
  - get_user
  - create_chat
  - update_chat
  - add_members
  - set_managers
  - remove_managers
  - dissolve_chat
  - upload_file
---

# 飞书

涉及成员的操作先用 `get_user` 取得稳定用户 ID。创建群聊后可添加成员、更新群设置和维护管理员；解散群聊属于不可逆操作，应依照 Tool 审批策略执行。文件发送前先用 `upload_file` 获得文件标识。

当前 Agent Tool 不提供当前群成员列表、踢人或独立群详情查询。
