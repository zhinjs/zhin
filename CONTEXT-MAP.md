# 上下文地图

## 上下文

- [Core IM Runtime](./packages/core/CONTEXT.md) - 负责 IM 适配器、消息、调度、命令/AI 路由和出站发送链。
- [Agent Runtime](./packages/agent/CONTEXT.md) - 负责 ZhinAgent 编排、工具、技能、子代理、上下文预算，以及对 `@zhin.js/ai` 的策略适配。
- [Queue Contract](./docs/architecture/queue/CONTEXT.md) - 定义队列侧事件和出站字段词汇，并说明它们如何映射到 IM 运行时类型。
- [Console Runtime](./packages/console-core/CONTEXT.md) - 负责控制台页面目录、PageManager、入口注册和浏览器插件启动。

## 关系

- **Core IM Runtime -> Agent Runtime**：Core 分发符合条件的 IM 消息；Agent Runtime 处理 AI 触发回合，并通过 Core 的发送链回复。
- **Agent Runtime -> Core IM Runtime**：Agent 工具和回复在 IM 边界使用 Core 的 `Tool`、`Message`、`SendOptions` 概念。
- **Queue Contract -> Core IM Runtime**：队列出站 payload 会先规范化为 Core `SendOptions`，再交给平台适配器发送。
- **Console Runtime -> Core IM Runtime**：控制台插件通过 `web` 上下文注册页面；适配器插件继续拥有平台相关的数据路由。
- **Console Runtime -> Agent Runtime**：面向 Agent 的控制台页面可以查看或操作 Agent Runtime 状态，但页面注册仍归 Console Runtime 管。

