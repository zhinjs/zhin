# Graceful Shutdown 协议

定义 Zhin 进程收到 SIGTERM/SIGINT 时的有序关闭流程，保证数据持久化、连接释放和资源清理。

## 状态

已接受（2026-06-10）· **已实现**（`packages/im/zhin/src/shutdown.ts`、`signal-handlers.ts`、`task-executor.drainTaskExecutorLocks`）

## 背景

四轮内存泄漏审计（ADR 0012）修复了单个组件的 `dispose()` 方法，但缺少统一的进程级 shutdown 协调。当前各组件各自为政：

- MCP connections 在 Agent dispose 时断开
- SSE subscribers 在 HTTP server close 时断开但不主动关闭
- PromptController 的 active turns 在 Agent dispose 时 abort
- Schedule timers 用 `unref()` 不会阻止退出，但也不保证 flush
- 写入中的数据库操作可能中断

需要一条从进程信号到组件 `dispose()` 的级联链路。

## 决策

### D1 — Shutdown 级联顺序

收到 SIGTERM/SIGINT 后按以下顺序执行：

```
SIGTERM/SIGINT
  └→ ZhinAgent.dispose()
       ├→ PromptController.dispose()          # abort active turns
       ├→ SubagentManager.dispose()            # cancel running tasks
       ├→ RemoteAgentRegistry.dispose()        # disconnect MCP
       ├→ Monitoring.dispose()                 # clear metrics
       ├→ TypingIndicator.dispose()             # cancel timers
       ├→ CompactionRuntime.clearCompactionStates()
       └→ Plugin tree stop (root → children)
            ├→ each plugin.stop()
            │    ├→ emit 'context.dispose' per context
            │    ├→ call each context's dispose function
            │    └→ removeListeners
            └→ signal handlers removed
  └→ Host layer
       ├→ stopSseHub()                          # close stale-check timer, close subscribers
       ├→ WebSocket server.close()              # ping/pong already handles zombies
       ├→ TaskExecutor drain pending tasks      # wait up to 5s
       └→ Database flush & close                # flush pending writes, close pool
  └→ Process exit(0)
```

核心原则：**先停写入，再停读取，最后释放资源**。

### D2 — Shutdown 超时

设置全局 shutdown 超时 `SHUTDOWN_TIMEOUT_MS = 10_000`（10 秒）。超时后强制 `process.exit(1)`。

每个子步骤有自己的软超时：
- PromptController abort: 即时
- Database flush: 最多 5s
- Plugin stop cascade: 最多 8s
- SSE/WS close: 即时

### D3 — Shutdown 入口

在 `packages/im/zhin/src/index.ts`（或新建 `packages/im/zhin/src/shutdown.ts`）添加：

```typescript
export function registerGracefulShutdown(agent: ZhinAgent, host?: { wss: WebSocket.Server }): void {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);
    const timeout = setTimeout(() => {
      logger.warn('Shutdown timeout, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await agent.dispose();
      stopSseHub();
      // host layer cleanup...
    } catch (err) {
      logger.error('Shutdown error:', err);
    } finally {
      clearTimeout(timeout);
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
```

### D4 — 各组件的 dispose 协定

所有管理长期资源的组件必须实现 `dispose()` 方法，遵循以下规则：

| 规则 | 说明 |
|------|------|
| `dispose()` 必须幂等 | 第二次调用为 no-op |
| `dispose()` 可以是 async | 调用方用 `await` 等待 |
| `dispose()` 必须取消所有 timers | `clearInterval` / `clearTimeout` |
| `dispose()` 必须关闭所有网络连接 | MCP, SSE, WS |
| `dispose()` 必须清空集合 | Map, Set, Array |
| `dispose()` 必须设 `this.disposed = true` | 阻止 dispose 后的新操作 |

已实现 `dispose()` 的组件（ADR 0012 修复后）：

- `BaseProvider.dispose()` — aborts all active requests
- `PromptController.dispose()` — aborts active turns, clears subscribers
- `SubagentManager.dispose()` — aborts running tasks
- `RemoteAgentRegistry.dispose()` — disconnects MCP connections
- `MetricsCollector.dispose()`, `AlertManager.dispose()`, `TraceCollector.dispose()`
- `TypingIndicatorManager.dispose()`
- `PromptTemplates.dispose()`
- `ZhinAgent.dispose()` — cascades to all sub-resources
- `MemoryAgentSessionStore.dispose()`
- `MemoryOrchestrationRepository.dispose()`
- `AdapterTypingIndicatorManager.dispose()`

### D5 — Hot-reload 场景

Plugin hot-reload 不走进程级 shutdown，走 Plugin `stop()` → `start()` 循环：

```
文件变更检测
  └→ plugin.stop()
       ├→ emit 'context.dispose' per context   ← ADR 0012 D7
       ├→ call context dispose functions
       ├→ removeListeners
       └→ clear children
  └→ plugin.start()
       └→ usePlugin() / useContext() 重新注册
```

关键保障：`stop()` 必须在清理每个 context 之前 emit `context.dispose`，让 `useContext` 注册的清理回调有机会执行。这是 ADR 0012 D7 的核心。

## 后果

- **正面**：进程退出不再丢数据或泄漏连接；hot-reload 不再累积观察者；运维可以安全 `kill -SIGTERM` 而不必担心数据丢失。
- **负面**：shutdown 增加了 8-10s 延迟；需要所有组件正确实现幂等 `dispose()`。
- **风险**：如果某个 `dispose()` 卡住（如数据库连接 hung），整个 shutdown 超时后才强制退出。需要监控 dispose 耗时。

## 未来工作

- P1 Event Stream 中断传播 — `AssistantMessageEventStream` 的 producer 感知 consumer break（ADR 0012 未决事项）
- P1 数据库连接池 drain on shutdown
- P2 内存压力监控指标暴露