---
"@zhin.js/agent": minor
"zhin.js": minor
"@zhin.js/gateway": minor
"@zhin.js/cli": patch
---

会话列表与审批卡片显示来自哪个聊天（zhinjs/zhin#1250 第 63 批）。全部是新增的可选字段，已有字段含义不变，不新增权限。

- `@zhin.js/agent`：trace 会话摘要（`TurnTraceArchive.sessions()`，Console `GET /api/agent/trace-archive/sessions`，权限仍是 `agent.view`）新增 `origin`（最近一个记录了来源的回合的来源，与回合 `origin` 同形状）、可读名 `platform`、`scope_kind`、`scene_label`、`display_name`（如 `sandbox · 私聊 · Developer`）与 `conversations`（一个会话跨多段聊天时每段的 `{ origin, turns, last_started_at }` 加同样的可读名字段，最近的在前，最多 10 段，超出时给 `conversations_total`）；旧 trace 没有来源时这些字段不出现。trace 的 `origin.conversation` 现在记录会话名 `name`（最长 128 个字符）。工具审批队列的卡片（`ToolApprovalEntry`）新增 `turnOrigin` 与 `turnOriginLabel`。`@zhin.js/agent/trace` 新增导出 `turnOriginLabelOf()`、`turnOriginDisplayName()`、`turnOriginKey()`、`withScheduleJobLabel()`、`summarizeTraceSessions()`、`sessionLabelFields()`、`withSessionScheduleLabels()`、`TURN_TRACE_SESSION_CONVERSATION_LIMIT` 与类型 `TurnOriginLabel`、`TurnTraceSessionConversation`、`TurnTraceSessionLabelFields`。
- `zhin.js`：Console `plugin.root.tool-approvals` 的卡片（`ToolApprovalCard`）新增 `origin`（与 trace `origin` 同形状）与可读名 `platform`、`scopeKind`、`sceneLabel`、`displayName`；trace 会话摘要里的定时任务会话、用量统计 `bySession` 里的 `schedule:<id>` 会话在实例还认得该任务时用任务的 `label` 命名（之前显示 `sched_<id>`）。
- `@zhin.js/gateway`：用量统计新增可选 resolver `resolveScheduleJob`（导出类型 `UsageScheduleJobResolver`），定时任务会话的 `sceneLabel` / `displayName` 用任务名。
- `@zhin.js/cli`：`zhin trace --sessions` 每行显示 `平台 · 私聊/群聊 · 名称（短会话键）`，跨多段聊天的会话在下面缩进列出每段聊天；没有记录来源的旧 trace 仍显示完整会话键。
