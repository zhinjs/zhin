# @zhin.js/next-feature-middleware

下一代 Runtime 的 Middleware Feature provider。它将 `middlewares/**/*.ts` 发现为 owner-bound Capability Slot，并把当前 generation 的全部 Slot 投影为确定性、可组合的 `MiddlewareIndex`。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

## 目录约定

```text
middlewares/
  trace.ts
  auth/
    guard.ts
```

- 递归发现 `middlewares/**/*.ts`，不接受 TSX。
- 目录和文件 basename 使用小写字母、数字与连字符。
- 相对路径形成稳定 localName，例如 `auth/guard`。
- 模块必须 default export `defineMiddleware(...)` 的结果。
- 目录只决定 Capability identity，不隐式改变执行优先级。

## 定义 Middleware

```ts
import { defineMiddleware } from '@zhin.js/next-feature-middleware';

export default defineMiddleware<Message>({
  target: 'inbound',
  phase: 'before-dispatch',
  order: -10,
  async handle({ input, owner, config, use }, next) {
    await authorize(input, config, use(databaseToken), owner.id);
    await next();
  },
});
```

`target` 默认为 `inbound`，也可设为 `outbound`；`phase` 默认为 `before-dispatch`，`order` 默认为 `0` 且必须是安全整数。Definition 是纯冻结值，不注册到模块全局，也不读取“当前 Plugin”。

## 排序与组合

`MiddlewareIndex` 固定按以下字段排序：

1. phase：`before-dispatch` 在 `after-dispatch` 前。
2. `order`：小值优先。
3. Plugin tree 的 parent-first topology order。
4. 稳定 CapabilityId。

```ts
const index = snapshot.projections.get(middlewareFeatureId);
if (!(index instanceof MiddlewareIndex)) throw new Error('Middleware is missing');

await index.run(message, () => dispatcher.dispatch(message, snapshot), 'inbound');
```

Middleware 使用 Koa 风格 onion compose：`await next()` 前执行进入逻辑，之后执行退出逻辑。一次执行只能调用一次 `next()`；重复调用会明确失败。整个 pipeline 使用同一个 `RuntimeSnapshot`，不会在执行中跨 generation。

`MiddlewareIndex.run(input, terminal, target)` 只执行对应 target。IM Runtime 用 `inbound` 包裹 Message dispatch、用 `outbound` 包裹渲染后的发送 envelope，因此中间件不会在两条链上意外重复执行。

## Execution Context

`MiddlewareContext` 提供 owner snapshot、generation、owner config、输入值和 `use(token)`。Resource 已在 commit 前按 Scope 继承关系展平，运行期读取是一次 Map lookup，不调用装配期 API。

## HMR

修改一个 Middleware 文件时，Runtime 只 invalidate/load 对应 Capability Slot，然后重建 generation projections。Plugin setup、Feature provider import 和其他 Middleware 模块不会重复执行；旧 snapshot lease 继续使用旧 pipeline。

## Plugin Manifest

```json
{
  "dependencies": {
    "@zhin.js/next-feature-middleware": "^0.0.0"
  },
  "zhin": {
    "features": [
      { "package": "@zhin.js/next-feature-middleware", "api": "^1.0.0" }
    ]
  }
}
```

## 开发验证

```bash
pnpm --filter @zhin.js/next-feature-middleware test
pnpm --filter @zhin.js/next-feature-middleware build
```

## 相关文档

- [Feature Kit](../feature-kit/README.md)
- [IM、Agent 与 Console Runtime](../../../docs/architecture/target-implementation/domain-runtimes.md)
- [Greenfield Bootstrap 状态](../../../docs/architecture/target-implementation/greenfield-bootstrap.md)
