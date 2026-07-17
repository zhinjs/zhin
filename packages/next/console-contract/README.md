# @zhin.js/next-console-contract

Console 的零 runtime dependency wire contract。它定义 Page metadata、Page/Layout manifest、canonical route、Navigation node 与 Shell slot props，不依赖 Kernel、React、Router 或构建器。

## Author API

```tsx
import { definePage } from '@zhin.js/next-console-contract';

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

`definePage()` 只验证并冻结 metadata。它不注册页面、不读取当前 Plugin，也不能指定 route。未提供的 title 在构建 Page manifest 时由文件名生成。

## Route SSOT

`pageRoute(owner, root, localName)` 是 canonical route 的唯一计算函数：Root 页面得到 `/p-<name>`，child 页面得到 `/<plugin-path>/p-<name>`。metadata 不包含 route override。

## Boundary

- Page/Layout module URL 与 hash 来自 Client Module build adapter。
- Host 与 Client 共享本包类型，避免维护第二份 route/nav 配置。
- Shell 继续拥有 Router、权限 guard、Error Boundary、响应式区域和可访问性。
