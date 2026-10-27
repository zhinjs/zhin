---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/adapter": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-napcat": patch
---

公告：草稿 → 审批 → 发送（ADR 0037 第 1 期切片 B）。

- 新表 `ai_announcements` 与 `AiAnnouncements`：状态只前进 `draft` → `pending` → `approved` → `sent`，旁路 `rejected` / `expired` / `failed`；`revision` 乐观并发；改正文回到 `draft` 并重算 `content_hash`；待审批默认 24 小时超时。
- 新工具 `announcement_draft`（`risk: safe`）：模型只能建草稿，不能提交、审批或发送。
- Console `plugin.root.announcements` / `announcement`（读）与 `announcement-create` / `-edit` / `-submit` / `-approve` / `-reject` / `-resend`（动作，暂用 `control:read` / `control:write`）。
- 批准即发送：摘要复核 → 控制面 → 会话画像 → 硬闸以公告审批记录作批准（`ToolHardGate.checkPreApproved`，不弹第二张卡）→ `EndpointManagement.sendGroupNotice`（icqq / napcat）。被拦或失败置 `failed`，不自动重试；重发回到 `pending` 需再批一次；摘要不符拒绝（`announcement_hash_mismatch`）。
- 审计追加 kind `announcement` 与码 `announcement_drafted` / `_submitted` / `_approved` / `_rejected` / `_expired` / `_sent` / `_send_failed` / `_resend` / `_hash_mismatch`。
