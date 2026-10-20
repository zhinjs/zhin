# @zhin.js/middleware

Zhin Plugin Runtime 的 Middleware Feature。它从 `middlewares/**/*/index.ts` 发现定义，并按
phase、order、Plugin topology 与 capability identity 形成稳定执行链。

依赖 `zhin.js` 时从门面导入（勿再单独安装本包）：

```ts
import { defineMiddleware } from 'zhin.js/middleware';

export default defineMiddleware({
  phase: 'before-dispatch',
  handle(_context, next) { return next(); },
});
```

Middleware 不直接持有 Root 或运行时 registry；每次执行使用同一 generation snapshot，
更新时由 Feature Slot 原子替换。

入站中间件可返回文本、JSX 或其他发送内容。`return next()` 保留下游的返回值与作者；
`await next()` 后不返回也透传下游结果，返回新内容则替换待自动回复内容。不调用 `next()`
会消费输入；不返回内容时不会自动回复。Runtime 在整条入站链回卷后只自动回复一次，
显式调用 `input.$reply()` 仍可发送多条消息。已经发送的显式消息不会被返回值替换撤回。

出站中间件使用 `target: 'outbound'`，通过 `input.replace(content)` 修改候选 payload，
再调用 `next()` 放行；返回类型为 `void`，不参与入站的自动回复与 continuation 传递。

`next()` 的 continuation 只用于透传，不暴露内容，也不可跨调用保存复用。每层只能调用
一次 `next()`；遗漏 await 的下游操作仍会在当前 scope 结束前结算，异常向调用方传播。

单文件插件可用 `setup({ addMiddleware })` 注册 `defineMiddleware(...)`；它仍参与
统一 phase/order/topology 排序和 generation 回滚。

验证：`pnpm --filter @zhin.js/middleware test && pnpm --filter @zhin.js/middleware build`。

生命周期与 HMR 说明见 [目标架构](../../docs/target-architecture.md)。
