# ADR 0038: Activity Feedback 资格与 Schedule 三相位

## 状态

Accepted

## 背景

- 人类入站 AI turn 需要 queued/thinking/active 类 activity feedback。
- Schedule / TaskExecutor turn 不应误触 `ai.processing.*` 的 queued/thinking/active。
- Schedule 任务在 `activityFeedback=true` 时需要独立的 start/finish/error 指示。

## 决策

### D1. `activityFeedbackEligible`

- `TurnContextStore.activityFeedbackEligible`：仅 **`register-ai-trigger` 人类入站** turn 为 `true`。
- TaskExecutor、subagent、deferred worker：`false`（经 `initScheduleTurnContext` / 默认）。

### D2. Schedule 三事件

| 事件 | 派发点 |
|------|--------|
| `schedule.start` | `TaskExecutor.executeTask` 入口（`activityFeedback=true`） |
| `schedule.finish` | 执行成功、投递前 |
| `schedule.error` | `catch` 失败路径 |

Activity Feedback 插件订阅上述事件；**不**走 `ai.processing.start/finish` 的 queued/thinking/active。

### D3. 门控

`isActivityFeedbackEnabled(payload, phase)`：

- 手动 turn + `activityFeedbackEligible===true` → queued/thinking/active
- Schedule turn + `scheduleActivityFeedback===true` → schedule_start / schedule_finish / schedule_error

### D4. 配置

`activityFeedback.schedule.phases: { start, error, finish }` per scene type（service 插件 config）。

## 实现位置

- [`turn-context.ts`](../../packages/im/agent/src/zhin-agent/turn-context.ts)
- [`schedule-guard.ts`](../../packages/im/agent/src/activity-feedback/schedule-guard.ts)
- [`task-executor.ts`](../../packages/im/agent/src/task-executor.ts)
- [`plugins/services/activity-feedback/src/ai-event-binder.ts`](../../plugins/services/activity-feedback/src/ai-event-binder.ts)

## 相关

- [ADR 0031 — Schedule 设施](./0031-schedule-facility-replace-cron.md)
- [ADR 0004 — Proactive 出站](./0004-normalize-queue-outbound-fields-before-im-send.md)
