# @zhin.js/tool

下一代 Agent Tool Feature。它从 Plugin 或项目根的 `tools/<name>.ts` 发现 `defineAgentTool()` definition，并投影为 owner-aware `ToolIndex`。

## 目录与身份

```text
tools/
├── get-weather.ts
└── search.ts
```

Tool 目录只允许一级 `.ts` 文件。文件 basename 是 owner 内部使用的 local name；Agent turn 对模型发布 owner-qualified name。Root 的 `get-weather` 仍是 `get-weather`，child `root/maps` 的同名 Tool 是 `maps__get-weather`。嵌套目录、TSX 和旧 `agent/tools` 不属于绿地接口。

## 定义 Tool

```ts
import { defineAgentTool } from '@zhin.js/tool';
import { weatherClientToken } from '../plugin.js';

export default defineAgentTool<{ city: string }>({
  description: 'Query current weather',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  approval: 'never',
  execute(input, context) {
    return context.use(weatherClientToken).get(input.city, context.config);
  },
});
```

`defineAgentTool()` 只校验并冻结声明，不定位当前 Plugin、不注册能力。`approval` 支持 `never`、`on-risk`、`once`、`always`，默认 `on-risk`；批准状态和判定由 Turn Tool Runtime 持有，本包只保留声明。

`inputSchema` 保持 provider-neutral，可以是 JSON Schema 或模型 adapter 能理解的其它只读描述。本包不引入 Zod，也不在 ToolIndex 重复实现 schema validator。

单文件插件可用 `setup({ addTool })` 注册 `defineAgentTool(...)`。Tool Feature 必须已在
插件 manifest 中挂载；注册结果与 `tools/` 目录进入同一 ToolIndex。

## Owner 解析

`ToolIndex.execute(requester, name, input, invocation)` 从 requester 向 Root 查找最近 definition。`invocation` 必须包含所属 Turn 的 `AbortSignal`、trace/turn/session identity、principal 与不可变 policy（permissions / unattended / network authority）；这些字段会连同声明 owner 的 config/resource 组成 `ToolExecutionContext`。网络 transport 必须读取该 context 的 authority，不能读取模块全局或自行猜测执行域。child 可覆盖继承的 Root Tool。

`list()` 返回全树 qualified descriptors；`visible(owner)` 返回该 owner 可见且完成 override 后的 local descriptors。

## HMR

Tool 文件变化只 reload 对应 Slot，再重建 generation projection。正在执行的 Agent turn 持有旧 snapshot lease，继续使用旧 Tool；新 turn 才看到新 definition。

## 依赖

仅依赖 Next Kernel 与 Feature Kit。AI SDK、模型 provider、approval UI、schema compiler 均不在生产依赖中。

## 验证

```bash
pnpm --filter @zhin.js/tool test
pnpm --filter @zhin.js/tool build
```
