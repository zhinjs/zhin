# @zhin.js/permission

统一鉴权面（PermissionHost），供命令 `permit`、工具 `permissions`、平台级权限校验使用。

## 核心概念

- **PermissionHost** — 解析 permit 字符串并校验是否通过。解析顺序：builtin → `platform(adapter,perm)` → 自定义 `register` → deny。
- **PermissionSubject** — 鸭式鉴权主体（与 `CommandSession` / `Message` 同构：adapter / endpoint / scene / sender）。
- **permissionHostToken** — Plugin Runtime Scope Token，`ImRuntime` 在根 Scope `provide`。

## 使用

```ts
import {
  PermissionHost,
  permissionHostToken,
  toPermissionSubject,
  assertPermitSyntax,
  type PermissionSubject,
} from '@zhin.js/permission';

const host = new PermissionHost();
```

### 命令 permit 校验

`defineCommand` 的 `permit` 字段支持 builtin DSL 和 `platform(adapter,perm)` 两种形态。构建期通过 `assertPermitSyntax` 做语法校验。

### 只读解释与假设检查

`explainPermitRules(permits, subject?, { rolesKnown? })` 只解析声明并复用内置纯判断，返回
`match` / `mismatch` / `unknown` / `not_evaluated`，不查询或执行 `PermissionHost` 的任何 checker。
角色未明确作为假设输入提供时，不会把空角色或默认角色当作已核验依据。
`platform(...)` 与未知规则保留为未执行；结果不是授权结论。

规则数组为 AND，同一项括号内逗号为 OR。`group()`、`private()`、`channel()` 的空值和
`*` 表示不限该场景的 ID；`adapter(*)` 没有通配语义。`master` 身份仅隐含
`trusted`，不会隐含平台的 `admin`。内置场景规则不约束 Endpoint、父容器或话题：
例如 `group(123)` 不能保证只在某个 Bot 账号的群或某个线程生效。

命令应使用 `@zhin.js/command` 的 `explainCommandPermissions`，它与实际命令准入复用
同一主体投影，并单独解释命令 `adapter` 的精确匹配约束，不能用单独的
`toPermissionSubject()` 替代命令侧角色优先级。

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
