---
name: icqq-group-admin
platforms:
  - icqq
description: ICQQ 群管理、撤回他人消息，以及仅主人可申请的退群操作；工具分别声明权限与审批要求。
keywords:
  - icqq
  - 群管理
  - 禁言
  - 踢人
  - 公告
  - 精华
  - 退群
  - 撤回他人消息
tools:
  - group_invite
  - group_kick
  - set_mute
  - set_title
  - set_anonymous
  - announce
  - essence
  - group_leave
  - recall_member_message
scopes:
  - group
---
# icqq-group-admin

仅在目标群和目标成员明确时加载。所有写操作遵守 Tool 审批与角色权限；不可逆或影响成员关系的操作先复核参数。

自动管群必须先确认具体规则和目标群，不能仅凭权限许可自行制定触发条件。

本技能的踢人工具每次都需人工审批，必须展示本次目标群、目标成员和理由；上一笔操作的批准不能授权下一笔踢人。

已配置的自动审核流程可对入群 10 分钟内的明确广告直接踢出；该例外由审核流程核验，不授权本技能或普通对话绕过人工审批。

`group_leave` 仅主人（master）可发起，每次人工审批，只能退出当前群。Bot 为群主时拒绝执行，因为 SDK 的退群会解散群。

`recall_member_message` 沿用 master/admin/trusted/owner 发起权限，无需逐次审批；目标固定在当前群中的真实消息。执行前实时查询 Bot 与目标成员角色：管理员只能撤回普通成员，群主可撤回管理员或普通成员。平台时限与执行结果仍然有效，不自动重试未确认的结果。

撤回 Bot 自己的消息不要求群管角色：使用 `icqq-messages` 的 `recall_own_message`。已配置自动群审核的撤回继续走原有审核路径，不因本工具新增审批，也不扩大审核类别或目标群。
