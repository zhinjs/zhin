# @zhin.js/service-activity-feedback

可选服务插件：订阅 AI 生命周期事件，按**顶层** `activityFeedback` 配置驱动各适配器能力。

## 模块结构

```
ZhinAgentEventEmitter.emit
        │
        ▼
activityFeedbackAiBus ──► ai-event-binder（薄） ──► ActivityFeedbackOrchestrator
                                                        │
                                   ┌────────────────────┼────────────────────┐
                                   ▼                    ▼                    ▼
                             context.ts           policy.ts            executor.ts
                        payload → 上下文      根级 YAML → phase 配置   platform/generic 统一执行
```

- **Orchestrator**：对外 `startPhase` / `stopPhase` / `updateThinkingText`
- **Policy**：根级 `activityFeedback` 合并与 phase 解析
- **Executor**：隐藏 platform 自管 manager 与 generic manager 双路径
- **Adapter**：仅提供 `$activityFeedback` IO 能力
- **Runtime slice-2**：`plugin.ts` setup 经 `activityFeedbackAiBus` 订阅（无 `usePlugin`）；
  endpoint access 暂为 noop（phase 在 resolve 失败时静默跳过）。
  **TODO**：注入真实 Adapter/endpoint access，使 typing/reaction 真正出站。

## 安装

```bash
pnpm add @zhin.js/service-activity-feedback @zhin.js/agent
```

## 启用

```yaml
plugins:
  - "@zhin.js/service-activity-feedback"

activityFeedback:
  enabled: true
  platforms:
    icqq:
      phases:
        active:
          group: { type: reaction, emoji: "60" }
```

详见 [Activity Feedback](../../../docs/advanced/activity-feedback.md)、[ADR 0034](../../../docs/adr/0034-activity-feedback-service-plugin.md)。
