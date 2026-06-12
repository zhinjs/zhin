---
sidebar: false
---

# 稳定性增强路线图

四轮审计修复了 52 项已存在的内存泄漏和生命周期缺陷（见 [ADR 0012](./0012-memory-lifecycle-stability-fixes.md)）。本文档列出尚未完成的增强项，按优先级分层。

## 状态

部分实现（2026-06-10）

| 优先级 | 状态 | 关键路径 |
|--------|------|----------|
| P0-1 ~ P0-3 | ✅ 已实现 | `api-registry.ts`、`shutdown.ts`、DB dialects |
| P1-1 ~ P1-3 | ✅ 已实现 | `service.dispose`、`ZhinAgent.dispose`、`BaseProvider.activeStreams` |
| P2-1 | ✅ 已实现 | `agent/src/stability/memory-pressure.ts` |
| P2-2 | ✅ 部分 | `stability-lifecycle.test.ts`、`session-write-lock.test.ts`、`api-registry.test.ts`；长压 RSS 测试未做（CI 不稳定） |
| P2-3 | ✅ 部分 | dispose/eviction/shutdown 路径已带 `{ code }`；全仓库 warn/error 未统一 |
| P2-4 | ✅ 部分 | 本文与 ADR 0013 已更新实现状态 |

## P0 — 运行时会炸（下个版本必须修）

### P0-1: Event Stream 中断传播

**问题**：`createAssistantMessageEventStream` 使用 push-based 模型。当 `complete()` 的 `for await` 循环被 `break`/`return`/`throw` 中断时，Python-style 的 async generator `return()` 方法会触发 generator 的 `finally`，但 push-based stream 的 producer 不知道 consumer 已经离开，会继续往队列推数据，底层 HTTP 连接也不释放。

**方案**：
```
AssistantMessageEventStream 增加 AbortSignal 参数
  ↓
complete(stream) for-await 被 break 时
  ↓
generator return() → finally 块 → abort signal
  ↓
producer push() 检查 signal.aborted → 停止推数据
provider chatStream 收到 abort → 关闭 HTTP 连接
```

**涉及文件**：
- `packages/im/ai/src/llm/api-registry.ts` — `createAssistantMessageEventStream` 增加可选 `signal`
- `packages/im/ai/src/llm/api-registry.ts` — `complete()` / `completeSimple()` 在 for-await 中传入 signal
- `packages/im/ai/src/llm/agent-loop.ts` — 将上游 signal 传入 complete
- 各 provider `chatStream` — 已支持 `request.signal`（Round 4 修复），需对接 event stream

**预估**：2-3 天

### P0-2: 进程级优雅关闭

**问题**：没有统一的 shutdown 钩子。SIGTERM 时各类单例（metrics、typing indicator、SSE hub、MCP connections、agent sessions）各自为政，可能丢数据或泄漏连接。

**方案**（详见 [ADR 0013](./0013-graceful-shutdown-protocol.md) D1-D3）：

```
SIGTERM/SIGINT
  └→ ZhinAgent.dispose()
       ├→ PromptController.dispose()
       ├→ SubagentManager.dispose()
       ├→ RemoteAgentRegistry.dispose()
       ├→ Monitoring.dispose()
       ├→ TypingIndicator.dispose()
       ├→ CompactionRuntime.clearCompactionStates()
       └→ Plugin tree stop
            ├→ emit 'context.dispose' per context
            └→ removeListeners
  └→ Host layer
       ├→ stopSseHub()
       ├→ WS.close()
       ├→ TaskExecutor drain (5s timeout)
       └→ Database flush & close
  └→ Process exit(0)
```

**涉及文件**：
- 新建 `packages/im/zhin/src/shutdown.ts`
- `packages/im/zhin/src/index.ts` — 注册 shutdown
- `packages/host/api/src/sse-hub.ts` — 已有 `stopSseHub()`
- `packages/im/agent/src/bootstrap.ts` — 暴露 `gracefulShutdown()`

**预估**：1-2 天

### P0-3: 数据库连接池生命周期

**问题**：未审计数据库层连接池的 acquire/release/timeout/drain 行为。

**方案**：
- 审计 `@zhin.js/database` 的连接池实现
- 添加 shutdown 时 `pool.end()` / `pool.drain()`
- 添加 acquire timeout（> 5s 则 abort）
- 添加 idle connection eviction

**涉及文件**：
- `packages/im/basic/src/database/` 或对应位置
- shutdown 链路

**预估**：1-2 天

---

## P1 — 长期运行内存泄漏（1-2 个版本内修）

### P1-1: 模块级全局注册表清理

**问题**：`providerConfigs`、`apiProviders`、`loadedModules`、`Registry` 等 module-level Map/Set 只有 test-only 的 `clearForTests()`，没有 production reset。插件 hot-reload 后旧条目可能残留。

**方案**：
- 每个注册表新增 `disposeAll()` 或 `reset()` 导出函数
- 在 Plugin stop / ZhinAgent dispose 链中调用
- `loadedModules` 改为在 plugin unload 时清理对应条目

**涉及文件**：
- `packages/im/ai/src/llm/api-registry.ts` — `providerConfigs` + `apiProviders`
- `packages/im/ai/src/llm/register-api-layer.ts` — `registeredApis`
- `packages/im/core/src/adapter.ts` — `Registry`
- `packages/im/kernel/src/plugin.ts` — `loadedModules`

**预估**：1 天

### P1-2: Agent Session 级联 dispose

**问题**：ZhinAgent.dispose() 已部分实现（Round 2），但缺少级联调用：
- 未调用 `clearCompactionStates()` for session
- 未调用 `disposeAdapterTypingIndicatorManager()`
- 需要确保 `promptController.dispose()` 在所有代码路径中被调用

**方案**：
- 补全 ZhinAgent.dispose() 的级联调用
- 添加集成测试：dispose 后验证子资源已清空
- 在 shutdown 链中验证 ZhinAgent.dispose() 被调用

**涉及文件**：
- `packages/im/agent/src/zhin-agent/index.ts`
- `packages/im/agent/src/zhin-agent/compaction-runtime.ts`
- `packages/im/agent/src/typing-indicator/adapter-integration.ts`
- `packages/im/agent/src/bootstrap.ts`

**预估**：1 天

### P1-3: 流式响应 AbortController 统一管理

**问题**：虽然 Round 4 加了 signal 传播，但如果上层没有传 signal（如 standalone `complete()` 调用），provider 内部的 AbortController 仍然没有取消入口。

**方案**：
- `BaseProvider` 增加 `activeStreams` 追踪 Set
- `Provider.dispose()` → cancelAll() 已有但要确保在 Agent dispose 链中被调用
- 在 `chatStream` 返回的 generator 被中断时，主动 abort 对应的 controller

**涉及文件**：
- `packages/im/ai/src/providers/base.ts`
- 各 Provider 子类

**预估**：0.5 天

---

## P2 — 防御性增强（持续改进）

### P2-1: 内存压力监控

**方案**：
- 在关键全局 Map 上暴露 `size` 指标：
  - `compactionStateBySession.size`
  - `MemoryAgentSessionStore.sessions.size`
  - `MemoryOrchestrationRepository.runs.size`
  - SSE `subscribers.size`
  - `pendingOrchestration.size`
- 当 size > threshold 时 log warn
- 当 size > 2×threshold 时主动 eviction
- 可选：接入 `process.memoryUsage()` 做整体 RSS 监控

**预估**：1 天

### P2-2: 稳定性集成测试

**方案**：
- **iterate-break 测试**：for-await 循环 break 后验证 AbortController 被清理、HTTP 连接关闭
- **dispose-cascade 测试**：ZhinAgent.dispose() 后验证所有子资源（promptController、subagent、compaction、session store）被清空
- **long-running-pressure 测试**：模拟 10000 轮对话后验证 RSS 不超过 baseline + 50MB
- **concurrent-session 测试**：50 并发 session 无 DeadLetterError / unhandled rejection

**预估**：2-3 天

### P2-3: 结构化日志标准化

**方案**：
- 所有 `Logger.warn/error` 调用统一带 `{ code }` 字段（如 `{ code: 'session_evict' }`）
- 每个 dispose/eviction 操作打 debug 级别日志
- 关键指标周期性上报（session count、active streams、pending MCP connections）

**预估**：1 天

### P2-4: ADR 文档化

**方案**：
- 写 ADR 记录 Event Stream 中断传播的设计决策
- 写 ADR 记录 graceful shutdown 协议实现（已有 ADR 0013，需更新为实现状态）
- 写 ADR 记录 Map eviction 80% threshold 的数学依据

**预估**：0.5 天

---

## 时间线

| 周次 | P0 | P1 | P2 |
|------|-----|-----|-----|
| W1 | P0-1 Event Stream + P0-2 优雅关闭 | | |
| W2 | P0-3 DB 连接池 | P1-1 注册表清理 + P1-2 Agent 级联 | |
| W3 | | P1-3 Stream 统一管理 | P2-1 监控 + P2-2 测试 |
| W4 | | | P2-3 日志 + P2-4 ADR |

**总预估**：4 周。P0 约 5-7 天，P1 约 2.5 天，P2 约 4.5 天，ADR 0.5 天。

## 验收标准

| 项 | 标准 |
|-----|------|
| P0-1 | `for await` break 后无 unhandled rejection，HTTP 连接在 5s 内关闭 |
| P0-2 | SIGTERM 后进程在 10s 内退出，无泄漏连接，数据库 flush 完成 |
| P0-3 | DB 连接池 acquire > 5s abort，idle > 30min eviction |
| P1-1 | Plugin hot-reload 后全局注册表 size 不增长 |
| P1-2 | ZhinAgent.dispose() 后所有子资源 size === 0 |
| P1-3 | Provider dispose 后 `activeStreams.size === 0` |
| P2-1 | 关键指标暴露到日志，超阈值时 warn |
| P2-2 | 4 项集成测试通过 |
| P2-3 | 所有 warn/error 日志带 code 字段 |