# ADR 0041: AgentStreamBus 与 AgentSessionHostPort

## 状态

Accepted

## 背景

ADR 0039/0040 引入 Host `/zhin/v1/session*` 与 HTTP step checkpoint 后，Agent stream egress 出现多条并行路径：

- `process-stream` / `turn-pipeline` 经 `HookRegistry.triggerStream` 发 wire 事件
- `HttpAgentSessionStore.runTurn` 二次映射 `TurnEvent` 并 `append` + `triggerStream`
- `agent-core-run` 对 HITL 事件双写 hooks 与 `getHttpAgentSessionRuntime()?.store.publishEvent`
- OAuth complete 在 REST 层手写 `publishEvent`

全局 `get/setHttpAgentSessionRuntime` 使 Host API 与 agent 运行时隐式耦合，不利于测试与多 agent 场景。

## 决策

### D1. AgentStreamBus（每 orchestrator 一个实例）

- `bus.publish(AgentStreamEvent, ctx?)` 为 **唯一 egress**；producer 不再直接 `triggerStream`。
- Sinks：
  - **HookSink** — 调用 `HookRegistry.triggerStream(..., { skipBus: true })` 防重入
  - **HttpSessionSink** — 过滤 `ctx.httpSessionId`，append `SessionEventLog` 并驱动 `StepProjector` / `ParkController`
- `TurnEvent` 仅在 `process-stream` 映射一次；`HttpTurnRunner` 只调用 `processStream`，不再二次映射。

### D2. SessionInteractionPort（仅阻塞交互）

- `requestApproval(opts): Promise<boolean>` 抽象 IM `AskUserBuiltinTool` 与 HTTP `HttpApprovalWaiter`
- Stream 事件（`input.requested` / `input.completed`）统一由 `runToolApprovalGate` 经 bus 发出
- 删除 `httpSessionId` 分支与 `onStreamEvent` 回调参数

### D3. HTTP Session 模块拆分

| 模块 | 职责 |
|------|------|
| `SessionEventLog` | append-only + subscribe |
| `StepProjector` | step.* wire 投影 |
| `ParkController` | pending 同步 + mid-turn `session.waiting` |
| `HttpTurnRunner` | `runTurn` → `processStream` |
| `HttpSessionSink` | bus → log / projector / park |
| `HttpAgentSessionStore` | 薄 facade：start/continue/submitInput/hydrate |

### D4. AgentSessionHostPort（Host 注入）

- 工厂 `createAgentSessionHostPort({ getAgent, bus, dataDir? })` 装配 store、sinks、turn runner
- `create-zhin-agent`：`root.provide('agentSessionHost', port)`；`priv.httpApprovalAdapter = port.httpApprovalAdapter`
- **删除** `http-agent-session-runtime-registry.ts` 及 `get/setHttpAgentSessionRuntime` 公开 export
- Host REST：`registerZhinAgentStreamRoutes(router, base, port: AgentSessionHostPort)`

### D5. OAuth

- `authorization-flow` 经 `publish` 回调发 `authorization.*`；REST complete 使用 `port.publishHttpSessionEvent`

## 后果

### 正面

- 单点映射 TurnEvent → wire；NDJSON 重放与 hooks 订阅同源
- Host API 显式依赖注入，测试可传 mock port
- HTTP 审批 waiter 实例级，无进程单例

### 负面（Breaking）

- 删除 `set/getHttpAgentSessionRuntime`、`getHttpApprovalWaiter`、`resolveHttpApproval` exports；仓库内调用方须迁移

## 实现追踪

| 项 | 落点 | 状态 |
|----|------|------|
| AgentStreamBus + HookSink | `event/agent-stream-bus.ts`、`hook-stream-sink.ts` | 已实现 |
| process-stream / turn-pipeline 迁 bus | `turn/process-stream.ts`、`turn-pipeline.ts` | 已实现 |
| SessionInteractionPort | `session/session-interaction-port.ts`、IM/HTTP adapters | 已实现 |
| tool-approval-gate + authorization-flow | `tool/tool-approval-gate.ts`、`connection/authorization-flow.ts` | 已实现 |
| Session 拆分 + HttpSessionSink | `session/*` | 已实现 |
| AgentSessionHostPort | `session/agent-session-host-port.ts` | 已实现 |
| Host 注入 | `init/create-zhin-agent.ts`、`host/api` | 已实现 |

## 相关

- [ADR 0039](./0039-eve-aligned-agent-surface-roadmap.md)
- [ADR 0040](./0040-http-step-checkpoint-persistence.md)
- [packages/im/agent/CONTEXT.md](../../packages/im/agent/CONTEXT.md)
