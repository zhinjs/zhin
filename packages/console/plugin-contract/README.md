# @zhin.js/console-contract

Console Plugin Runtime 的零依赖 wire contract。它定义 Page metadata、Page/Layout manifest、
canonical route、Navigation node 与 Shell slot props，不依赖 AI、React、Router 或构建器。

```tsx
import { definePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: 'Service status',
  icon: 'Activity',
  order: 10,
  requiredPermissions: ['status:read'],
});

export default function StatusPage() {
  return null;
}
```

`definePage()` 只验证并冻结 metadata，不注册页面，也不能覆盖 route。
`pageRoute(owner, root, localName)` 是路由的 SSOT：Root 页面为 `/p-<name>`，child 页面为
`/<plugin-path>/p-<name>`。模块 URL 与 hash 来自可选 Client Build adapter。

```bash
pnpm --filter @zhin.js/console-contract build
pnpm --filter @zhin.js/console-contract test
```
