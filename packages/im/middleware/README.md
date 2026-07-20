# @zhin.js/middleware

Zhin Plugin Runtime 的 Middleware Feature。它从 `middlewares/**/*.ts` 发现定义，并按
phase、order、Plugin topology 与 capability identity 形成稳定执行链。

```ts
import { defineMiddleware } from '@zhin.js/middleware';

export default defineMiddleware({
  phase: 'before-dispatch',
  async handle(_context, next) { await next(); },
});
```

Middleware 不直接持有 Root 或运行时 registry；每次执行使用同一 generation snapshot，
更新时由 Feature Slot 原子替换。

验证：`pnpm --filter @zhin.js/middleware test && pnpm --filter @zhin.js/middleware build`。

生命周期与 HMR 说明见 [目标架构](../../docs/target-architecture.md)。
