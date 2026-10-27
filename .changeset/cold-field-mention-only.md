---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

冷场 → 会话临时 `mention_only`（ADR 0037 第 1 期切片 C，§1.3）。

- 会话运营配置新增 `coldField.enabled`（默认关，只能按会话打开）/ `coldField.threshold`（默认 20）/ `coldField.durationMs`（默认 30 分钟）；读库失败时视为关闭。
- 只统计群消息：未点名且旁听判定不参与计 1；点名、旁听参与、Bot 主动发言（scene event 唤醒、模板欢迎、公告）清零。命中阈值给该会话加控制面临时 `mention_only`（`actor=policy`、`expiresAt`），到期自动撤销。
- 临时覆盖与运营者手动覆盖分存、只会更严、不进 `revision`，在 `control` 查询的 `temporary[]` 里可见；`control-set` 显式写 `mention_only: false` 时一并清除。计数与临时覆盖只在进程内存。
- 审计复用 `control_change` / `control_gate`，追加码 `cold_field_mention_only_on` / `cold_field_mention_only_expired` / `cold_field_mention_only_cleared`；决策回放 `decisions` / `decisions-export` 新增可选 `reasonCode` 过滤（`DecisionEventQuery.reasonCode`）。
