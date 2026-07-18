# ADR 0040: HTTP Step Checkpoint 持久化与 session.waiting park/resume

## 状态

Accepted（P3 最小可交付）；跨重启 mid-turn durable / agent loop 级细粒度 checkpoint = **Deferred**（客户端重发契约；本硬稳定化轮次不实现）。

## 背景

ADR 0039 P3 要求 **Step 级 durable 持久化** 与 **`session.waiting` park/resume**，以缩小与 Eve Workflow SDK 在 Host HTTP 会话上的差距。Zhin 已有：

- P0：`HttpAgentSessionStore` + `continuationToken` + NDJSON 事件日志（进程内）
- P1：`input.requested` / `authorization.required` 事件与 Host 回调
- IM 侧：`agent_sessions` DB + `InboundTurnQueue`（**不在本 ADR 范围**）

Eve 的 Workflow SDK 将 **step** 作为 durable 单元：已完成 step 不重跑，中断 step 在 resume 时重跑。Zhin 若引入 Vercel Workflow SDK 会与 ADR 0019 安装分层、IM 栈解耦目标冲突（ADR 0039 D5）。

## 决策

### D1. 不采用 Vercel Workflow SDK

Host `/zhin/v1/session*` 路径使用 **自研 JSON 文件快照**（`FileHttpSessionPersistence`），默认目录 `{cwd}/data/http-agent-sessions/`。可选关闭（无 `dataDir` 时行为与 P0 相同，纯内存）。

### D2. Step 边界（HTTP turn 段）

在 HTTP 会话中，**一个 step = 一次 `turn.started` → `turn.completed` / `turn.failed` 区间**（对应一次 `processStream` 调用内的 agent turn）。发出 wire 事件：

- `step.started` / `step.completed` / `step.interrupted`

语义对齐 Eve 子集：

| 状态 | 含义 | resume 行为 |
|------|------|-------------|
| `completed` | turn 正常结束 | 不重跑；新用户消息开启新 step |
| `interrupted` | turn 内出现 `input.requested` 或 `authorization.required` | 同进程内通过 `POST .../input` 或 OAuth 回调解除；**跨重启**仅恢复事件日志与 `continuationToken`，**整段 turn 需客户端重新 `continueSession`**（agent loop 中途 checkpoint 见 D4） |

### D3. Park / resume（同进程）

当 `commMessage.extra.httpSessionId` 存在时，`runToolApprovalGate` **不走 IM `ask_user`**，改为 `HttpApprovalWaiter` 阻塞直至 `POST /zhin/v1/session/:sessionId/input`。**mid-turn** 收到 `input.requested` / `authorization.required` 时**立即**发出 `session.waiting`（`parked: true`，`reason: 'parked'`）；turn 正常结束后发出 `session.waiting`（`parked: false`，`reason: 'idle'`）。

OAuth 仍走既有 `POST /zhin/v1/authorization/:requestId/complete`；`authorization.required` 标记 step `interrupted`。

### D4. 与 IM / DB session 共存

- **不修改** `AgentSessionStore`（`agent_sessions` 表）、`InboundTurnQueue`、`Message.$reply` 链。
- HTTP step checkpoint **仅** 服务于 Host SDK / Console 订阅；IM 入站会话的 park/resume 仍依赖现有同步机制，长期可与本设施桥接（非本 ADR）。

### D5. 跨重启限制（显式非目标）

本 ADR **不** 序列化 agent loop 中间状态（tool call 栈、LLM messages 指针）。进程重启后：

- 可从磁盘 **hydrate** 会话事件、steps、`continuationToken`
- **无法** 从中断的 tool approval 中间自动续跑；客户端须用新 `continuationToken` 发 `continueSession` 或 `/input`（若 waiter 已丢失则 `/input` 返回 `REQUEST_NOT_FOUND`）

细粒度 agent loop checkpoint 需独立 ADR（可能复用 ADR 0009 context repository 或 orchestration kernel）。

## 后果

### 正面

- Host 会话在 dev/prod 重启后可 **审计** 完整 NDJSON 历史与 step 列表。
- Console/SDK 可展示 `step.*` 与 `session.waiting.parked`。
- HTTP 审批与 Eve `input.requested` 模型对齐，无需 IM 在线用户。

### 负面

- 文件快照与内存状态需同步；高并发写同一 session 未加锁（HTTP session 设计为单客户端单会话）。
- 跨重启 mid-turn resume 未解决；文档须明确。

## 实现追踪

| 项 | 落点 | 状态 |
|----|------|------|
| Step 类型与 wire 事件 | `@zhin.js/ai/agent-step-checkpoint` | 已实现 |
| 文件持久化 | `FileHttpSessionPersistence` | 已实现 |
| Step 追踪 | `HttpStepProjector` | 已实现 |
| HTTP 审批 park | `HttpApprovalWaiter` + `runToolApprovalGate` | 已实现 |
| Store 集成 | `HttpAgentSessionStore` | 已实现 |
| REST | `POST /zhin/v1/session/:sessionId/input` | 已实现 |
| 启动 hydrate | `createAgentSessionHostPort({ dataDir })` | 已实现 |

## 相关

- [ADR 0039](./0039-eve-aligned-agent-surface-roadmap.md)
- [eve-comparison-zh.md §2.8](../advanced/eve-comparison-zh.md)
- [agent-authoring.md](../advanced/agent-authoring.md)
