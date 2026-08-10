# @zhin.js/permission

统一鉴权面（PermissionHost），供命令 `permit`、工具 `permissions`、平台级权限校验使用。

## 核心概念

- **PermissionHost** — 解析 permit 字符串并校验是否通过。解析顺序：builtin → `platform(adapter,perm)` → 自定义 `register` → deny。
- **PermissionSubject** — 鸭式鉴权主体（与 `CommandSession` / `Message` 同构：adapter / endpoint / scene / sender）。
- **permissionHostToken** — Plugin Runtime Scope Token，`ImRuntime` 在根 Scope `provide`。

## 使用

```ts
import {
  createPermissionHost,
  permissionHostToken,
  toPermissionSubject,
  assertPermitSyntax,
  type PermissionHost,
  type PermissionSubject,
} from '@zhin.js/permission';
```

### 命令 permit 校验

`defineCommand` 的 `permit` 字段支持 builtin DSL 和 `platform(adapter,perm)` 两种形态。构建期通过 `assertPermitSyntax` 做语法校验。

### 适配器注册平台 checker

```ts
// adapter plugin.ts
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';

export default definePlugin({
  name: 'my-adapter',
  setup(context) {
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('my-adapter', createSceneRolePlatformChecker());
    }
  },
});
```

### 自定义 permission

```ts
import { definePermission, definePlatformPermission } from '@zhin.js/permission';

// 名称匹配
export default definePermission({
  name: 'can_deploy',
  check: (name, subject) => subject.sender?.role?.includes('admin') ?? false,
});

// 正则匹配
export default definePermission({
  name: /^feature\./,
  check: (name, subject) => true,
});
```

## 层级

```
@zhin.js/plugin-runtime
  ↓
@zhin.js/permission  ← 本包
  ↓
@zhin.js/command / @zhin.js/core / @zhin.js/agent（消费者）
```

不依赖 `@zhin.js/core`——通过 `PermissionSubject` 鸭式接口解耦。
