# 上下文地图

## 上下文

- [Core IM Runtime](./packages/im/core/CONTEXT.md) - 负责 IM 适配器、消息、调度、命令/AI 路由和出站发送链。
- [Agent Runtime](./packages/im/agent/CONTEXT.md) - 负责 ZhinAgent 编排、工具、技能、子代理、上下文预算，以及对 `@zhin.js/ai` 的策略适配。
- [Host Router](./packages/host/router/) - Koa + `@koa/router`、Bearer、CORS（传输层）。
- [Host API](./packages/host/api/) - 管理面 REST、Console 协议、`PageManager` / `entries`（需与 host-router 同启）。
- [PageManager](./packages/console/pagemanager/CONTEXT.md) - 负责控制台页面目录、PageManager、入口注册和浏览器插件启动。

## 关系

- **Core IM Runtime -> Agent Runtime**：Core 分发符合条件的 IM 消息；Agent Runtime 处理 AI 触发回合，并通过 Core 的发送链回复。
- **Agent Runtime -> Core IM Runtime**：Agent 工具和回复在 IM 边界使用 Core 的 `Tool`、`Message`、`SendOptions` 概念。
- **Console Runtime -> Core IM Runtime**：控制台插件通过 `web` 上下文注册页面；适配器插件继续拥有平台相关的数据路由。
- **Console Runtime -> Agent Runtime**：面向 Agent 的控制台页面可以查看或操作 Agent Runtime 状态，但页面注册仍归 Console Runtime 管。
