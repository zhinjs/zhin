---
name: icqq-group-admin
platforms:
  - icqq
description: ICQQ 邀请、踢人、禁言、头衔、匿名、公告和精华管理能力。
keywords:
  - icqq
  - 群管理
  - 禁言
  - 踢人
  - 公告
  - 精华
tools:
  - group_invite
  - group_kick
  - set_mute
  - set_title
  - set_anonymous
  - announce
  - essence
scopes:
  - group
---
# icqq-group-admin

仅在目标群和目标成员明确时加载。所有写操作遵守 Tool 审批与角色权限；不可逆或影响成员关系的操作先复核参数。

自动管群必须先确认具体规则和目标群，不能仅凭权限许可自行制定触发条件。

本技能的踢人工具每次都需人工审批，必须展示本次目标群、目标成员和理由；上一笔操作的批准不能授权下一笔踢人。

已配置的自动审核流程可对入群 10 分钟内的明确广告直接踢出；该例外由审核流程核验，不授权本技能或普通对话绕过人工审批。
