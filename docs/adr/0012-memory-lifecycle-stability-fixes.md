# 内存与生命周期稳定性修复

在四个审计轮次中系统性修复了 IM + AI 框架的内存泄漏、资源悬挂和异步生命周期缺陷。本文记录每个修复的决策理由和备选方案。

## 状态

已接受（2026-06-10）

## 背景

长时间运行的 Zhin 实例暴露了以下系统性问题：

1. **异步生命周期不完整** — async generator 缺少 `try/finally`，consumer early break 导致消息数组、AbortController 等资源悬挂；`.then()` 链缺少 `.catch()` 导致 unhandled rejection。
2. **内存边界缺失** — Map/Set 几乎没有上界，session、compaction state、SSE subscriber、orchestration run 持续增长直到 OOM。
3. **取消信号断裂** — `AbortSignal` 从 `agentLoop` 到 HTTP fetch 之间的传播链路有多处断裂，consumer 取消后底层 HTTP 连接不释放。
4. **资源 dispose 不完整** — 多个组件缺少 `dispose()` 方法，Plugin `stop()` 不触发 `context.dispose`，导致 hot-reload 后观察者泄漏。

## 决策

### D1 — `reader.releaseLock()` 优先于 `reader.cancel()`

**选择**：在 `finally` 块中调用 `reader.releaseLock()`。

**备选**：调用 `reader.cancel()` 然后 `releaseLock()`。

**理由**：`cancel()` 会中断 Response body drain，可能导致底层 TCP 连接不可复用。`releaseLock()` 是非破坏性的——它释放 reader 锁让 Response body 自然排空，connection 回到 keepalive 池。对于 SSE 长流场景，connection 复用更重要。

**适用于**：`providers/base.ts`、`providers/anthropic.ts`、`providers/ollama.ts` 的 `chatStream`。

### D2 — 每个 stream 独立 AbortController，通过 `addEventListener` 链接父信号

**选择**：`parentSignal.addEventListener('abort', () => controller.abort(), { once: true })`。

**备选 A**：`AbortController.any([parentSignal])` — Node.js 20.12+ 支持，但 min-app-version 为 ^20.19.0，可以考虑。
**备选 B**：在 agentLoop 层创建单个 AbortController 并传递给所有子调用。

**理由**：每个 stream 有独立的生命周期（超时、错误关闭），但需要响应上级取消。`addEventListener` 方案不改变 controller 的 owner，不需要 `AbortController.any` 的 polyfill。`{ once: true }` 避免泄漏。

**适用于**：`fetchStream(parentSignal?)`、Anthropic/Ollama `chatStream`、OpenAI `chatStream`。

### D3 — 字符串累积改用 `string[]` + `join()`

**选择**：stdout/stderr 捕获从 `string += chunk` 改为 `chunks.push(chunk)` + `chunks.join('')`。

**理由**：`string += chunk` 在 V8 中对长字符串触发 O(n²) 拷贝（每次拼接创建新字符串）。`chunks.join()` 一次性分配。在高频日志场景下差异达数量级。

**适用于**：`agentsandbox.ts`、`sandbox-enhanced.ts`。

### D4 — MCP connect 失败不污染 registry

**选择**：`connect()` 失败时先 `disconnect()` 再 rethrow；`Map.set()` 仅在连接成功后执行。

**备选**：连接前 `Map.set(placeholder)`，失败时 `Map.delete()`。

**理由**：先 set 再 delete 在并发场景下可能让其他调用拿到未就绪的连接。post-success set 保证 registry 中只有可用连接。

**适用于**：`mcp-client/connection.ts`、`mcp-client/index.ts`、`remote-agent-registry.ts`。

### D5 — Adapter `start()` 幂等：先 stop 再 start

**选择**：`start()` 开头调用 `stop()` 清理现有 bots。

**理由**：避免 hot-reload 场景下 `start()` 被调用两次导致事件监听器重复注册。`removeAllListeners()` 在 `stop()` 中已处理 handler 清理。

**适用于**：`packages/im/core/src/adapter.ts`。

### D6 — Map eviction 使用 80% threshold

**选择**：当 Map size 超过上限时，驱逐到上限的 80%（例如 MAX=2000 → 驱逐到 1600）。

**备选**：每次只驱逐一个条目。

**理由**：单条目驱逐导致每秒触发 eviction（频繁迭代 Map）。80% 阈值意味着下一次 eviction 在距离 20% 增长量之后才触发，减少开销。这是 Redis `maxmemory-policy` 使用的模式。

**适用于**：所有加了 `MAX_*` 限制的 Map — `MemoryAgentSessionStore`、`MemoryStore`、`MemoryOrchestrationRepository`、`compactionStateBySession`。

### D7 — Plugin `stop()` 发出 `context.dispose` 事件

**选择**：在 `stop()` 清理 `$contexts` 之前，对每个 context 先 `emit('context.dispose', name)`。

**备选**：不 emit，依赖 `onDispose` 回调注册的清理。

**理由**：`useContext` 注册的 side-effect 依赖 `context.dispose` 事件来运行清理回调。如果 `stop()` 不 emit，这些回调永远不会被调用——hot-reload 场景下每次加载/卸载都会泄漏一个观察者。

**适用于**：`packages/im/kernel/src/plugin.ts`。

### D8 — SSE 半开连接用 stale-check 定时器，WS 用 ping/pong

**选择**：
- SSE：每 60s 扫描 `lastActive > 5min` 的 subscriber 并 `close()`
- WS：每 30s ping，未 pong 则 `terminate()`

**备选**：
- SSE：用 `Response.body.cancel()` 主动关闭 — 需要存储 body reference，增加耦合
- WS：用 `isAlive` flag + `close()` — `terminate()` 更彻底且不触发 handshake

**理由**：SSE 的 heartbeat 已经在 Round 1 中添加（15s 间隔），但 half-open 连接不会触发 cancel。定时扫描 + lastActive 阈值是生产级方案。WS ping/pong 是 RFC 6455 标准的 keepalive 机制。

**适用于**：`packages/host/api/src/sse-hub.ts`、`packages/host/api/src/websocket.ts`。

### D9 — `withLock` 使用 gate pattern 替代 `then(fn, fn)`

**选择**：
```typescript
const gate = new Promise<void>(resolve => release = resolve);
const next = prev.then(() => gate, () => gate);
await prev.catch(() => {});
try { return await fn(); } finally { release(); }
```

**备选**：`prev.then(fn, fn)` — 当前实现。

**理由**：`then(fn, fn)` 在 `prev` reject 时调用 `fn` 作为 rejection handler，导致任务重试。gate pattern 确保 `fn` 只在 `prev` settle 后执行一次，且 `fn` 的错误不会影响后续排队。

**适用于**：`packages/im/agent/src/task-executor.ts`。

### D10 — `SessionWriteLock` 的 rejection 路径吞掉但不忽略

**选择**：`await prev.catch(() => {})` 然后 `next = prev.then(() => gate, () => gate)`。

**理由**：lock 的语义是「上一个完成后再执行」，不关心上一个成功还是失败。`prev.catch(() => {})` 防止 unhandled rejection；第二个 `then` 参数让 gate 不依赖上游状态。等待方仍然会等 `prev` settle 再执行 `fn`。

**适用于**：`packages/im/ai/src/memory/session-write-lock.ts`。

### D11 — PromptController `dispose()` abort 所有 active turns + 清空 subscribers/waiters

**选择**：遍历 `activeTurns`，每个 `abortController.abort()`，然后 clear 所有集合。

**理由**：PromptController 是 ZhinAgent 的核心调度器，dispose 时如果有正在执行的 turn 不取消，turn 内的 LLM 调用会继续消耗 token 和网络资源。所有等待 idle 的 waiter 应立即 resolve，否则 `waitForIdle()` 永远 hang。

**适用于**：`packages/im/agent/src/zhin-agent/prompt-controller.ts`。

### D12 — `pendingOrchestration` 添加定时 sweep

**选择**：每 5 分钟扫描过期条目并删除，`unref()` 定时器。

**备选**：仅依赖读时清理（当前实现）。

**理由**：读时清理要求 key 被再次访问才能清理。如果 key 写入后不再被读取，条目永不删除。定时 sweep 是兜底策略。

**适用于**：`packages/im/agent/src/security/owner-approve-always-store.ts`。

## 四轮修复清单

### Round 1（22 项）
- Provider stream reader releaseLock + provider dispose + cancelAll
- MCP per-request server/transport finally 关闭
- Plugin 生命周期事件监听器 dispose 注册
- Metrics/AlertManager/TraceCollector 容量限制 + dispose
- TypingIndicatorManager dispose
- BudgetLimiter eviction
- PromptTemplates MAX_VERSIONS + dispose
- Cost-tracker reset 清 customPricing
- Adapter start 幂等
- API registry queue cap
- ZhinAgent dispose 清所有子资源
- BotHub pendingRequest TTL eviction

### Round 2（8 项）
- Sandbox string accumulation → string[]
- MCP connect-then-add-to-Map pattern
- Adapter stop removeHandler 正确性
- SSE heartbeat + botHub pending request TTL

### Round 3（11 项）
- agentLoop / runStream try/finally
- MemoryAgentSessionStore MAX + eviction + dispose
- ConversationMemory MemoryStore MAX + eviction
- PromptController dispose
- Plugin stop emit context.dispose
- SSE stale-check + WS ping/pong
- SessionWriteLock .catch()
- task-executor withLock gate pattern
- ConversationMemory .then() .catch()

### Round 4（11 项）
- fetchStream / Anthropic / Ollama AbortSignal 传播
- ChatCompletionRequest 新增 `signal` 字段
- compactionStateBySession MAX + eviction + clearCompactionStates()
- pendingOrchestration sweep timer
- MemoryOrchestrationRepository MAX + eviction + dispose
- AdapterTypingIndicatorManager dispose + clearAll 委托
- SSE stopSseHub() export
- register-builtin-tools setTimeout .unref()

## 后果

- **正面**：长时间运行实例 RSS 增长率大幅降低；consumer early break 不再泄漏资源；hot-reload 场景下不再累积观察者；半开 SSE/WS 连接被及时清理。
- **负面**：eviction 导致冷路径访问时需要重建 session state；80% 阈值意味着实际内存峰值可达上限的 120%（从 80% 增长回上限期间）。这是可接受的 trade-off。
- **风险**：`try/finally` 修改了 async generator 的控制流，需要关注回归测试中 generator break 的行为。

## 未决事项

见 ADR 0013 — Graceful Shutdown 协议。