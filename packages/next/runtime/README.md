# @zhin.js/next-runtime

下一代 Zhin 的 Root 组合层。它把静态 package manifest、Plugin graph、层级配置、ModuleRuntime、Feature discovery、source ownership 与 generation transaction 组装为一棵可启动、可局部 HMR、可安全停止的 Plugin tree。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

## 主要职责

- 解析 `package.json#zhin`，解析 workspace 或 npm 依赖中的 child Plugin 与 Feature provider。
- 校验一级 monorepo、循环依赖、instance identity 和静态 package graph。
- 用每个 Plugin 的 `schema.json` 组合层级 ConfigView。
- parent-first 执行 Plugin setup，并生成 owner-scoped Resource snapshot。
- 发现 Capability，构造所有 Feature projection，并原子提交完整 generation。
- 为 source 建立 owner/slot/manifest/schema 反向索引。
- 把文件变化规划为 slot、subtree 或 process 级失效。
- 串行合并 watcher burst，并在失败时保留 active generation。

Runtime 不定义具体能力语义，也不内置 TypeScript 编译器或 watcher。开发工具通过 `ModuleRuntime` adapter 接入，Vite、CSS 编译器和大型 native/wasm 依赖不得进入默认生产闭包。

## 最小启动

```ts
import { RootRuntime, EsmModuleRuntime } from '@zhin.js/next-runtime';

const runtime = new RootRuntime({
  projectRoot: process.cwd(),
  modules: new EsmModuleRuntime(),
  environment: { name: 'production', mode: 'production', platform: 'node' },
  config: parsedConfigDocument,
  installResources({ resources, lifecycle }) {
    resources.provide(databaseToken, database);
    lifecycle.add(() => database.close());
  },
});

await runtime.start();
const lease = runtime.controller.snapshots.acquire();
try {
  await executeWith(lease.value);
} finally {
  lease.release();
}
await runtime.stop();
```

`EsmModuleRuntime` 只适用于 Node 可直接 import 的模块。TypeScript 开发模式应提供独立 adapter，实现 `load`、`invalidate`、`affectedSources` 与 `watch`。

## Plugin Manifest

```json
{
  "name": "@acme/root",
  "dependencies": {
    "@acme/plugin-reports": "workspace:*",
    "@acme/feature-command": "workspace:*"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "runtime": "trusted",
    "features": [{ "package": "@acme/feature-command", "api": "^1.0.0" }],
    "plugins": [{ "package": "@acme/plugin-reports", "instanceKey": "reports" }]
  }
}
```

拓扑只来自静态 manifest，不从 `plugin.ts` 的执行副作用中发现。`runtime: isolated` 已进入协议，但当前实现会明确拒绝启动。

## 配置模型

Root 配置文档使用 `plugin` 保存自身字段、`plugins` 保存 child envelope。每个 Plugin 只收到自己的冻结 ConfigView；child 配置不会泄漏给 parent。`ConfigComposer` 使用 Draft 2020-12 JSON Schema 校验组合结果。

## HMR 粒度

| 变化 | 执行范围 |
|---|---|
| 单个能力文件 | 只 reload 对应 Capability Slot |
| child `plugin.ts` / `schema.json` | 只 shadow setup 对应 Plugin forest |
| Root、manifest、Feature provider、未知 importer | 完整 shadow generation |
| lockfile / workspace definition | 请求 process restart |

局部 prepare 仍发布完整 immutable snapshot。所有 Feature projection 都针对候选 snapshot 重建；失败时 shadow disposer 逆序执行，active generation 不变。

## 关键扩展点

| API | 用途 |
|---|---|
| `ModuleRuntime` | 模块加载、失效、反向 importer closure 与 watcher port |
| `RootResourceInstaller` | 向 Root Scope 安装数据库、配置存储等共享 Resource |
| `ConfigComposer` | 从 Plugin graph 与 Root document 生成 owner-scoped 配置 |
| `ProjectGraphService` | 解析静态 Plugin/Feature package graph |
| `InvalidationPlanner` | 将 source closure 提升为 slot/subtree/process plan |
| `HmrCoordinator` | 合并 burst、串行 invalidate/reload 与错误通知 |

## 安装体积

生产闭包预算为 5MB，当前只允许 Kernel、Feature Kit 与 AJV 等运行时必需依赖。门禁同时拒绝 Vite、`@vitejs/*` 与 lightningcss。

## 开发验证

```bash
pnpm --filter @zhin.js/next-runtime test
pnpm --filter @zhin.js/next-runtime build
pnpm --filter @zhin.js/next-runtime check:size
```

## 相关文档

- [Greenfield Bootstrap 状态](../../../docs/architecture/target-implementation/greenfield-bootstrap.md)
- [Config、Discovery 与 HMR](../../../docs/architecture/target-implementation/config-discovery-hmr.md)
- [Plugin 生命周期 ADR](../../../docs/adr/0047-standalone-plugin-and-root-lifecycle-domain.md)
- [Next 架构总览](../README.md)
