---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

入群欢迎 / 退群记录（ADR 0037 第 1 期切片 A）。

- 会话运营配置 `AiSessionOps` 与新表 `ai_session_ops`：按 `platform + scene_id` 存放，与会话画像分开；`welcome.enabled`（默认关）/ `template` / `mergeWindowMs`（60s）/ `maxPerHour`（10）/ `rulesUrl`，`leave.record`（默认开，只写审计）/ `leave.notify`（默认关，本期不发）。读不出时一律不发欢迎。
- 模板变量白名单 `{members}` `{nickname}` `{group}` `{rules_url}`，未知变量原样保留。
- 欢迎：入群 → 合并窗口 → 小时上限 → 控制面 → 会话画像发言判定 → 出站；被拦只写审计不补发，失败不重试。会话开启欢迎后 scene event 不再因入群唤醒模型（避免双发）。
- 审计追加 kind `member_lifecycle` 与码 `welcome_sent` / `welcome_merged` / `welcome_rate_limited` / `welcome_disabled` / `member_leave_recorded`。
- Console `plugin.root.session-ops` / `session-ops-preview`（只渲染，不发送不审计）/ `session-ops-set`（`expectedRevision`，变更写 `config_change`）。
