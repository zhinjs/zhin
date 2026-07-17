# @zhin.js/next-feature-mcp

下一代 MCP Client Feature。它从 `mcp/<name>.ts` 发现 provider-neutral client definition，并将连接实例的创建、启动、调用和销毁绑定到 Plugin owner 与 generation lease。

## 目录约定

```text
mcp/
├── filesystem.ts
└── memory.ts
```

只发现一级 `.ts` 文件。连接参数、URL、command 和 secret 应从 owner config/resource 读取，不写入另一份全局 MCP 配置 registry。

## 定义 MCP Client

```ts
import { defineMcp } from '@zhin.js/next-feature-mcp';
import { mcpTransportFactoryToken } from '../plugin.js';

export default defineMcp({
  description: 'Workspace filesystem tools',
  create(context) {
    const client = context.use(mcpTransportFactoryToken).create(context.config);
    return {
      start: () => client.connect(),
      stop: () => client.close(),
      listTools: () => client.listTools(),
      callTool: (name, input) => client.callTool(name, input),
    };
  },
});
```

`create()` 在 projection prepare 中执行，只能构造 inert client；网络连接必须放在 `start()`。具体 stdio/HTTP transport 和 MCP SDK 由 Plugin Resource 或可选 adapter 提供，本包没有相关第三方依赖。

## 生命周期

```text
prepare candidate: create()
before commit:     candidate.start()
commit:            publish new McpIndex
old lease = 0:     previous.stop()
rollback:          candidate.stop()
```

MCP 没有入站 admission，因此候选连接不 quiesce 旧 client。旧 turn 可继续通过旧 projection 完成在途调用；新 turn 只看到已启动并已提交的新 client。要求排他连接时，应把连接资源提升到 Plugin Resource handoff。

`McpIndex` 对连接使用 owner inheritance。动态工具名由 client 返回；orchestrator 可投影为 `{connection}__{tool}`，但该模型命名不改变 Capability identity。

## 验证

```bash
pnpm --filter @zhin.js/next-feature-mcp test
pnpm --filter @zhin.js/next-feature-mcp build
```
