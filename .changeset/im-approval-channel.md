---
"@zhin.js/agent": minor
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/im-contract": minor
---

IM 渠道审批（#1250）：回合内审批提示按会话决定谁能确认——全局 owner 本人、群聊里的 Bot 主人（与之前相同），主人无法作答时（私聊或未配置主人）由在场的 zhin `admin` 发起人本人确认（仅「允许一次 / 拒绝」，不记住，`requiresApproval: 'human'` 工具仍需主人）；其他用户只能对「读取外部内容后的高危动作」确认自己的意图，这一确认（`scope: 'intent'`）不能代替普通审批。确认消息走原出站链，只认同一平台用户 ID 在同一会话（端点 / 会话 / 话题）里的「确认 / 取消 / yes / no」或按钮回调，他人回复、跨会话、过期按钮无效，超时按拒绝。私聊里非主人且无管理员身份的审批不再空等超时，直接说明原因。给模型的拒绝原因区分无人值守、此会话没有确认渠道、被拒 / 超时，并提示可在 Console 操作（定时任务：「运维 → 定时任务」），不再让模型把工具名当聊天命令推荐。审批提示里的密钥字段与令牌打码（执行仍用原参数）。每次回合内确认写 `tool_approval` 决策审计（`channel: turn_prompt`、`purpose`；新增原因码 `tool_approval_unavailable`）。`ApprovalRequestInput.purpose`、`ApprovalOutcome.scope`、`formatApprovalDenial` 的可选上下文参数、`formatApprovalBlocked`、`resolveImApprover`、`describeApprovalChannelConflicts` 为新增 API。`execApprovalMode: ask`，或 `confirmHighRisk` 未关闭且启用了定时任务 / 助理提醒时，启动日志提示一次配置冲突；`zhin doctor` 新增「审批渠道」检查。`UserInteractionRequest` 新增可选字段 `purpose?: 'approval'`（`UserInteractionPurpose`），审批确认消息带上它。
