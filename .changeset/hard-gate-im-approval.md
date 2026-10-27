---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

危险工具硬闸 IM 审批通道（G6，#1013）：`ai.agent.toolHardGate.imApproval`，默认关闭。

- 配置：`enabled`、`approverIds`（扁平列表或 `platform → userIds`）、`delivery: dm | approver_group`、`approverGroupId`（审批群模式必填，且不能是业务会话）。
- 新审批卡片经触发调用的 Endpoint 私聊投递给 allowlist 审批人（或发到专用审批群），内容含工具、类别、会话、脱敏参数摘要、卡片 id、过期时间；投递失败不重试，卡片照常留给 Console、超时拒绝。
- 审批人私聊 `/approve <id>` / `/deny <id>` 结算同一个 `ToolApprovalQueue`，与 Console 先到先得；群 / 频道消息与触发会话一律不能结算；仍是 humanOnly、一次一批，不提供本会话 / 永久授权，`bypass` 与审核 Agent 不能放行。
- 审计：`tool_approval` 结算记录 `payload.channel`（`console` / `im_dm` / `im_approver_group` / `turn_prompt`），IM 操作者记 `actor_id = im:<platform>:<userId>`；Console 审批卡片 RPC 返回 `channel`。
