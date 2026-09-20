# @zhin.js/tool

Agent Tool Feature。它从命名目录的 `index.ts` 发现 `defineAgentTool()` definition，并投影为 owner-aware `ToolIndex`。

## 目录与身份

```text
tools/
└── get-weather/
    ├── index.ts
    └── weather-client.ts
```

公共 Tool 使用 `tools/<name>/index.ts`。Agent 私有 Tool 使用 `agents/<agent>/tools/<name>/index.ts`；Skill 私有 Tool 使用 `skills/<skill>/tools/<name>/index.ts`；Agent 内 Skill 的私有 Tool 使用 `agents/<agent>/skills/<skill>/tools/<name>/index.ts`。目录段提供稳定 identity，辅助模块与入口共置。

四种位置同时是披露边界：插件启用后，模型基线只接收根 Tool 以及 Agent/Skill 的摘要；Agent Tool 仅在选择该 Agent 后进入其能力集，Skill Tool 仅在 `load_skill` 激活所属 Skill 后解锁，Agent Skill Tool 同时受这两层约束。所有 definition 仍在候选 generation 中完成校验，避免激活时才暴露语法、权限或依赖错误；渐进的是模型上下文和可调用能力，不是安全校验。

## 定义 Tool

```ts
import { defineAgentTool } from '@zhin.js/tool';
import { weatherClientToken } from '../../plugin.js';

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

`defineAgentTool()` 只校验并冻结声明，不定位当前 Plugin、不注册能力。`approval` 支持 `never`、`on-risk`、`once`、`always`，默认 `on-risk`；批准状态和判定由 Turn Tool Runtime 持有，本包只保留声明。标准 Host 中 `once` 可在当前会话记住 Tool，`always` 永不缓存；`on-risk` 仅在专用风险策略尚未覆盖该操作时请求确认。

`inputSchema` 只有两种契约：根节点为 `object` 的 JSON Schema，或同时实现
`safeParse()` 与 `toJSONSchema()` 的可执行 Schema。Zod 4 object 原生满足后一契约；Zod 3
内部结构和仅靠字段形状模拟的对象不会被接受。`@zhin.js/tool` 是 Schema 准入、模型投影和
执行前解析的唯一所有者；投影明确使用输入语义，因此默认值和 transform 不会被误写成模型
必须提供的输出字段。本包不依赖 Core，也不把转换责任交给模型 adapter。

单文件插件可用 `setup({ addTool })` 注册 `defineAgentTool(...)`。Tool Feature 必须已在
插件 manifest 中挂载；注册结果与约定目录进入同一 ToolIndex。

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
