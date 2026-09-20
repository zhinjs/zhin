---
name: icqq
platforms: [icqq]
description: ICQQ 用户查询、群互动、群管理、群文件和群公告能力。
keywords: [icqq, qq, 群管理, 群文件, 禁言, 踢人, 公告, 精华, 点赞]
tags: [adapter, qq, community]
tools:
  - user_info
  - send_user_like
  - poke
  - group_member_info
  - group_invite
  - group_kick
  - set_mute
  - list_muted
  - set_title
  - set_anonymous
  - group_sign
  - group_files
  - announce
  - essence
---

# ICQQ

涉及用户或群成员时，先用 `user_info` 或 `group_member_info` 核对稳定 ID。群管理操作只在目标群明确且当前身份有相应权限时执行；踢人、禁言、邀请、公告、精华、匿名开关和群文件操作均遵守 Tool 自身的权限与审批策略。

互动类操作包括 `poke`、`send_user_like` 和 `group_sign`。管理类操作包括 `group_kick`、`set_mute`、`set_title`、`set_anonymous`、`announce` 和 `essence`。查询禁言列表或群文件时使用对应只读工具，不根据昵称猜测用户 ID。
