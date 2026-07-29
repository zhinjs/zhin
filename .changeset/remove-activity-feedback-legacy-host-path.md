---
"@zhin.js/service-activity-feedback": patch
---

移除 activity-feedback 遗留的 legacy host Plugin 路径（依赖旧 `@zhin.js/core` `Plugin` 类型的死代码）：

- 删除 `bindActivityFeedbackToAIEvents`、`mountActivityFeedbackService`、`createActivityFeedbackOrchestratorFromPlugin`（`src/ai-event-binder.ts`）——这些接收旧 `Plugin`/`Plugin.root`、走 ALS 版 `subscribeAIEvents`，无任何运行时消费者与测试覆盖。
- 删除 `createRootEndpointAccess`（`src/executor.ts`）——legacy root path 专用的 endpoint 访问器，随上述函数一并成为孤儿。
- 从桶文件 `src/index.ts` 移除对应 re-export。

运行时入口 `plugin.ts` 走的是 Plugin Runtime 路径（`activityFeedbackAiBus` + OutboundHost），不受影响；插件层不再有对旧 core `Plugin` 类型的依赖。
