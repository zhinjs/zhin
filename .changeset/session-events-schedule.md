---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

会话日程 `ai_session_events` 与到点提醒（ADR 0037 第 1 期切片 D，§2）。

- 新表 `ai_session_events`（`revision` 乐观并发）与存储 `AiSessionEvents`：`at` 本身总会提醒，`remind_before` 追加提前量；已触发的偏移记入 `fired`，全部触发后 `done`；创建 / 修改时已过去的偏移直接记为已触发。
- 模型工具 `session_event_create`（`risk: safe`）只能为当前群 / 频道建事件；修改 / 取消只经 Console RPC `session-events` / `session-event` / `session-event-create` / `session-event-update` / `session-event-cancel`（`control:read` / `control:write`）。
- 到点唤醒复用 job-scheduler 的 `ScheduleEngine` 计时（不写 `schedule-jobs.json`）：`inbound_wake` / `schedule_wake_fired` → 控制面（按被点名判定，`mention_only` 不拦）→ 会话画像 → 模板直发（不调模型）。被拦 / 失败记为已触发、不补发；同一会话同一分钟的提醒合并为一条；重启后错过超过 10 分钟（`DEFAULT_SESSION_EVENT_GRACE_MS`）的写 `schedule_wake_missed` 不发。Bot 经日程发言后旁听窗口与冷场计数清零。
- 审计新增 kind `schedule` 与码 `schedule_event_created` / `_updated` / `_cancelled`、`schedule_wake_fired` / `_missed` / `_merged`；决策回放可按 `kind=schedule` 过滤。
