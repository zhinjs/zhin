---
"@zhin.js/agent": minor
"zhin.js": minor
"@zhin.js/gateway": minor
"@zhin.js/cli": patch
---

会话列表与审批卡片显示来自哪个聊天（zhinjs/zhin#1250 第 63 批）。全部是新增的可选字段，已有字段含义不变，不新增权限。

- `@zhin.js/agent`：trace 会话摘要（`TurnTraceArchive.sessions()`，Console `GET /api/agent/trace-archive/sessions`，权限仍是 `agent.view`）新增 `origin`（最近一个记录了来源的回合的来源，与回合 `origin` 同形状）、可读名 `platform`、`scope_kind`、`scene_label`、`display_name`（如 `sandbox · 私聊 Developer`、`定时任务 每日早报`，与用量统计 `bySession[].displayName` 同格式）与 `conversations`（一个会话跨多段聊天时每段的 `{ origin, turns, last_started_at }` 加同样的可读名字段，最近的在前，最多 10 段，超出时给 `conversations_total`；只有 IM 会话、定时任务与内部来源分段，A2A / MCP / HTTP 回合同一会话只算一段）；旧 trace 没有来源时这些字段不出现。trace 的 `origin.conversation` 现在记录会话名 `name`（最长 128 个码点）；平台给的名字（群名、发起人显示名）在记录与生成可读名时清理控制字符、U+2028/2029 与双向控制符（转义为 `\uXXXX`）并按码点截断，新增导出 `sanitizeOriginText()`。工具审批队列的卡片（`ToolApprovalEntry`）新增 `turnOrigin` 与 `turnOriginLabel`。`@zhin.js/agent/trace` 新增导出 `turnOriginLabelOf()`、`turnOriginDisplayName()`、`turnOriginKey()`、`withScheduleJobLabel()`、`summarizeTraceSessions()`、`sessionLabelFields()`、`withSessionScheduleLabels()`、`TURN_TRACE_SESSION_CONVERSATION_LIMIT` 与类型 `TurnOriginLabel`、`TurnTraceSessionConversation`、`TurnTraceSessionLabelFields`。
- `zhin.js`：Console `plugin.root.tool-approvals` 的卡片（`ToolApprovalCard`）新增 `origin`（与 trace `origin` 同形状）与可读名 `platform`、`scopeKind`、`sceneLabel`、`displayName`（卡片的 IM `origin` 只保留 `platform`、`endpoint`、`scope`、`sceneId` 与 `conversation: { kind, id, name? }`，新增导出类型 `ToolApprovalCardOrigin`）；trace 会话摘要里的定时任务会话、用量统计 `bySession` 里的 `schedule:<id>` 会话在实例还认得该任务时用任务的 `label` 命名（之前显示 `sched_<id>`）。
- `@zhin.js/gateway`：用量统计新增可选 resolver `resolveScheduleJob`（导出类型 `UsageScheduleJobResolver`），定时任务会话的 `sceneLabel` / `displayName` 用任务名；会话名清理控制字符与双向控制符（新增导出 `sanitizeSessionText()`、`formatSessionDisplayName()`），缺 `platform` 时取会话的适配器，空白的 `scope` / `sceneId` 退回 `conversation.kind` / `conversation.id`。
- `@zhin.js/cli`：`zhin trace --sessions` 每行显示 `平台 · 私聊/群 名称（短会话键）`（与 `zhin usage report` 同格式，输出前转义控制字符），跨多段聊天的会话在下面缩进列出每段聊天；没有记录来源的旧 trace 仍显示完整会话键。
