---
"@zhin.js/agent": patch
---

危险工具硬闸与群管工具对齐（ADR 0036 §2/§3、ADR 0037 §3，#1011 G1–G3）：

- 改他人群名片归 `member`：新增 `set_group_card`；场景管理通用工具 `{prefix}_set_nickname`（`setMemberNickname`）改归 `member`。Bot 自身改昵称请用 `set_self_nickname` / `set_bot_nickname`（`identity`）或声明 `riskCategory`。
- 核心名单按 `{prefix}_{suffix}` 后缀匹配（至少两段），补齐场景管理通用工具 `remove_member` / `ban_member` / `unban_member` / `set_moderator` / `rename_scene` / `set_scene_muted`，以及 `set_group_name` / `set_anonymous`。
- 硬闸接入控制面（#1008）：会话处于 `emergency_stop` / `read_only`（含状态不可用）时危险工具在弹审批之前直接拒绝，审计 `tool_hard_gate` + `control_emergency_stop` / `control_read_only`；`muted` 不拦硬闸管理工具。
