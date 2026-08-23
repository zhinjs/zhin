# @zhin.js/service-activity-feedback

可选服务插件：订阅 AI 生命周期事件，按插件实例配置驱动各适配器能力。

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
- **Executor**：隐藏 platform 自管 manager 与 generic manager 双路径，并按 Endpoint 声明能力选择 reaction / typing / message
- **Adapter**：仅提供 `$activityFeedback` IO 能力
- **Runtime**：`plugin.ts` setup 经 `activityFeedbackAiBus` 订阅（无 `usePlugin`），
  通过 generation-owned `outboundHostToken` 访问当前 Endpoint；发送、撤回、编辑、
  reaction 与原生 typing 均走统一 IM Runtime 控制链路。

同一 IM 会话的异步状态事件按产生顺序串行投影，主 Agent、工具迭代、子 Agent
以及 Schedule 的开始/完成/失败不会互相抢写。Endpoint 未声明某项操作时会按实际
能力降级为可安全清理的 reaction、typing、message 或 none，不按平台名称猜测隐藏方法。

## 安装

```bash
pnpm add @zhin.js/service-activity-feedback @zhin.js/agent
```

随后在项目 `package.json#zhin.plugins` 挂载插件：

```json
{
  "zhin": {
    "plugins": [
      {
        "package": "@zhin.js/service-activity-feedback",
        "instanceKey": "activity-feedback"
      }
    ]
  }
}
```

## 启用

```yaml
plugins:
  activity-feedback:
    enabled: true
    platforms:
      icqq:
        phases:
          active:
            group: { type: reaction, emoji: "60" }
```

详见 [Activity Feedback](../../../docs/advanced/activity-feedback.md)、[ADR 0034](../../../docs/adr/0034-activity-feedback-service-plugin.md)。
