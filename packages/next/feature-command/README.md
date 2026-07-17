# @zhin.js/next-feature-command

下一代 Runtime 的 Command Feature 垂直切片。它证明能力可以完全由独立 npm 包提供：目录发现、definition API、校验、Capability Slot 和 Runtime index 都不进入 Kernel。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

## 目录约定

```text
commands/
  status.ts
  gh/
    issue/
      list.ts
```

- 递归发现 `commands/**/*.ts` 与 `commands/**/*.tsx`。
- 每级目录与文件 basename 必须使用小写字母、数字和连字符。
- 相对路径构成 canonical localName，例如 `gh/issue/list`。
- 模块必须 default export `defineCommand(...)` 的结果。

## 定义 Command

```ts
import { defineCommand } from '@zhin.js/next-feature-command';
import { databaseToken } from '../plugin.js';

export default defineCommand({
  description: 'Show service status',
  async execute({ args, config, owner, generation, use }) {
    const database = use(databaseToken);
    return database.status({ args, config, owner: owner.id, generation });
  },
});
```

`CommandContext` 提供：

| 字段 | 语义 |
|---|---|
| `owner` | 声明 Command 的 Plugin instance snapshot |
| `generation` | 当前执行所租用的 generation |
| `config` | owner-scoped immutable 配置 |
| `args` | 调用参数 |
| `use(token)` | 从 owner 展平后的 Resource snapshot 读取依赖 |

运行时路径不访问可变 Plugin registry，也不会调用装配期 API。

## Runtime Name

- Root 的 `commands/status.ts` 暴露为 `status`。
- Root 的 `commands/gh/issue/list.ts` 暴露为 `gh issue list`。
- `root/group` 的 `commands/status.ts` 暴露为 `group status`。
- Plugin instance path 与 Command 相对路径共同组成命令词；同名投影会明确报错，不按扫描顺序覆盖。

## 使用 Projection

```ts
import { CommandIndex, commandFeatureId } from '@zhin.js/next-feature-command';

const projection = snapshot.projections.get(commandFeatureId);
if (!(projection instanceof CommandIndex)) throw new Error('Command Feature is missing');

console.log(projection.list());
await projection.execute('group status', ['verbose']);
```

调用方应在一次请求开始时 lease `RuntimeSnapshot`，并只使用该 snapshot 中的 `CommandIndex`。

## Plugin Manifest

```json
{
  "dependencies": {
    "@zhin.js/next-feature-command": "workspace:*"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "features": [
      { "package": "@zhin.js/next-feature-command", "api": "^1.0.0" }
    ],
    "plugins": []
  }
}
```

## HMR 行为

Command 文件变化只重新 load 对应 Capability Slot，然后为新 generation 重建 `CommandIndex`。Plugin Scope、配置和未变化 Resource 继续复用；旧请求仍使用旧 index，直到 lease 释放。

## 开发验证

```bash
pnpm --filter @zhin.js/next-feature-command test
pnpm --filter @zhin.js/next-feature-command build
```

## 相关文档

- [Domain Runtime](../../../docs/architecture/target-implementation/domain-runtimes.md)
- [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)
- [Next 架构总览](../README.md)
