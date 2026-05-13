# 集中 IM 入站路由

IM `message.receive` 处理集中到 Core 的 inbound runner，而不是分散在 adapter emit 逻辑、dispatcher 初始化和 middleware fallback 中。执行顺序固定为 dispatcher、plugin lifecycle、adapter observers；遗留 plugin middleware 不属于真实 IM 入站路径，因为命令和 AI 路由需要一条权威管线。

