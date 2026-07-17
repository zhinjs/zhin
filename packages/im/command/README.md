# @zhin.js/command

Zhin Plugin Runtime 的 Command Feature。它把 `commands/**/*.ts` 的目录层级映射为命令
路径，并支持 `[name:type=default]` 参数文件名、owner-scoped Config/Resource 与确定性匹配。

```ts
import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: 'Show runtime status',
  execute: ({ args }) => args.join(' '),
});
```

definition 在 import 时不注册全局状态；Feature provider 在 generation prepare 阶段发现、
校验并投影 `CommandIndex`。生产 manifest 指向 `lib/provider.js`。

验证：`pnpm --filter @zhin.js/command test && pnpm --filter @zhin.js/command build`。

命令目录契约见 [Plugin Runtime 原位迁移](../../../docs/architecture/target-implementation/in-place-migration.md)。
