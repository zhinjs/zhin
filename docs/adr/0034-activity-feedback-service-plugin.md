# ADR 0034：Activity Feedback 服务插件

状态：Accepted

## 决策

Agent、子 Agent、工具迭代与 Schedule 只发布传输无关的生命周期事件。可选的 `@zhin.js/service-activity-feedback` 订阅这些事件，并通过 `outboundHostToken` 将状态投影到 IM。

平台操作只允许通过 Adapter Endpoint 显式声明的 `recall`、`edit`、`reaction`、`typing` 控制端口执行。服务插件不得按平台 SDK 方法名探测能力，也不得持有跨 generation 的 Endpoint 单例。

同一 IM 会话的事件必须串行投影；不同会话可以并行。终态反馈必须自动清理，插件卸载时必须撤销订阅、定时器和仍存活的临时状态。

## 结果

- 不支持原生 typing 的平台可降级为状态消息。
- 支持 edit 的平台能原位显示工具/迭代进度，减少消息刷屏。
- 子 Agent 使用独立状态键，不覆盖主回合。
- Schedule 的开始、完成、失败拥有一致的用户可见反馈。
