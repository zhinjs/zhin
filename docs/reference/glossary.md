# 术语表

> 每项标注 **L1 / L2 / L3**：你大概在哪个学习阶段会遇到。

## 消息与调度

| 术语 | 级别 | 简述 |
|------|------|------|
| **MessageDispatcher** | L2 | 入站消息调度器：Guardrail → Route → Handle（命令 / AI）。`zhin.js` 默认会注册。 |
| **Guardrail** | L2～L3 | Dispatcher 第一阶段：必须 `next()` 才放行；适合鉴权、限流、全局过滤（如消息过滤 Feature）。 |
| **exclusive** | L2 | 路由默认模式：命中命令则不走 AI；否则再判 AI。 |
| **dual** | L3 | 双轨：命令与 AI 独立判定；可配置顺序与是否允许两次回复。 |
| **`message.receive`（插件生命周期）** | L2 | 根插件上的事件：在 **`MessageDispatcher.dispatch` 完成之后** 触发。适合收件箱、统计。 |
| **`adapter.on('message.receive')`** | L3 | 适配器级监听：在 **插件生命周期之后** 调用；仅建议用于 **观测/UI**，不作业务路由。 |
| **`before.sendMessage`** | L2 | 出站统一钩子：所有 `sendMessage` / `$reply` 路径都会经过，可改写发出内容。 |
| **`replyWithPolish` / `getOutboundReplyStore`** | L3 | Dispatcher 与 `before.sendMessage` 协作的润色机制；依赖异步上下文，见 [AI 文档](/advanced/ai)。 |

## 插件与运行时

| 术语 | 级别 | 简述 |
|------|------|------|
| **Plugin / `usePlugin()`** | L1～L2 | IM 侧插件单元；`usePlugin()` 按文件归属插件树。 |
| **Feature** | L2 | 能力模块（如 `CommandFeature`、`ToolFeature`），通过 `provide` 挂到根上下文。 |
| **`PluginBase`（kernel）** | L3 | `@zhin.js/kernel` 中的通用插件基类；**不等同于** `@zhin.js/core` 的 `Plugin`，IM 主路径以 `core` 为准。 |
| **`addMiddleware`** | L2～L3 | 在 Dispatcher **主处理之后** 执行的扩展链；前置拦截优先 Guardrail。 |

## 包与生态

| 术语 | 级别 | 简述 |
|------|------|------|
| **@zhin.js/ai** | L3 | 与 IM 无关的 LLM / Agent 循环等。 |
| **@zhin.js/agent** | L3 | IM 场景下 ZhinAgent、AIService 等编排。 |
| **@zhin.js/satori** | L3 | **Vercel satori** 的 SVG 渲染工具包；**不是** [Satori 协议适配器](https://www.npmjs.com/package/@zhin.js/adapter-satori)。 |

返回 [学习路径](/essentials/learning-paths)。
