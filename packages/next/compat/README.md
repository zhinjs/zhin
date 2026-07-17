# @zhin.js/next-compat

Zhin Next 的显式迁移适配层。它把少量可证明等价的旧回调形状转换为新 Feature definition，帮助旧 Plugin 分批移出模块级 `add*()` 注册。

> 本包不是旧 Runtime，也不提供 `usePlugin()`、全局当前 Plugin、动态 Feature registry 或双写。

## 设计边界

- compat 只适配函数签名，不拥有发现、identity、Scope 或 lifecycle。
- 生成结果仍是普通 `defineCommand()` / `defineMiddleware()` definition，由约定目录发现。
- owner config、Resource 与 generation 都来自新 Runtime。
- 需要 Plugin Context、权限服务或动态注册的旧逻辑必须显式重构，不能由 facade 猜测。
- 本包零第三方依赖且不进入默认 Zhin 安装。

## Legacy Command

```ts
import { defineLegacyCommand } from '@zhin.js/next-compat';

export default defineLegacyCommand({
  description: 'show issue',
  action: async (message, result) => {
    return `${message.sender}: ${result.params.issue}`;
  },
});
```

`message` 来自新 Command dispatch 的 `input`；`result.params` 是文件路由解析后的类型化参数，`result.args` 是剩余参数。compat 不重新执行旧 SegmentMatcher，也不恢复 `.permit()` 等隐式服务访问。

## Legacy Middleware

```ts
import { defineLegacyMiddleware } from '@zhin.js/next-compat';

export default defineLegacyMiddleware(async (message, next) => {
  await audit(message);
  await next();
});
```

Middleware 仍由 `middlewares/*.ts` 的 owner Scope 发现；adapter 只把新 context 的 `input` 传给旧 `(input, next)` 回调。

## 迁移工具

[`zhin-next migrate`](../cli/README.md) 会为安全的旧 `MessageCommand` builder 生成本包 definition。自动提取只接受没有文件级闭包捕获的 inline action；其余项进入 manual inventory。

## 开发验证

```bash
pnpm --filter @zhin.js/next-compat test
pnpm --filter @zhin.js/next-compat build
pnpm --filter @zhin.js/next-compat check:size
```

## 相关文档

- [迁移契约](../../../docs/architecture/target-implementation/migration-contract.md)
- [ADR 0050](../../../docs/adr/0050-next-migration-and-compatibility-boundary.md)
- [Next 架构总览](../README.md)
