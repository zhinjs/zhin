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
- 将 manifest 前后两棵 graph 编译为 child/Feature topology transaction。
- 识别 Root runtime contract 与 package ABI 边界，并执行受控进程重启。
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
  onControlError(error) {
    logger.error(error, 'A committed Resource failed to open admission');
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

## Compatibility Gate

`ProjectGraphService` 在 import Plugin/Feature 模块之前执行两层 semver 门禁：

- 每个 mounted package 的 `zhin.engine` 必须满足 Runtime Engine API `1.0.0`。
- Plugin Feature requirement 的 `api` 必须匹配 provider package 的具体 `featureApi`。

无 requirement 时，已声明的 `featureApi` 仍必须是合法版本。range/version 格式错误、缺失 provider API 或版本不满足都会抛出 `PackageCompatibilityError`，因此不会产生 setup/discovery 副作用。兼容的 engine/API contract 发生变化仍属于 process restart 边界。

## 配置模型

Root 配置文档使用 `plugin` 保存自身字段、`plugins` 保存 child envelope。每个 Plugin 只收到自己的冻结 ConfigView；child 配置不会泄漏给 parent。`ConfigComposer` 使用 Draft 2020-12 JSON Schema 校验组合结果。

`config` 可以是内存对象、只读 resolver 或 `ConfigDocumentPort`。Port 在 `start()` 时提供带 revision 的原始文档，并将 patch 分成 inert prepare、commit 与 rollback；文件格式实现位于可选的 [`@zhin.js/next-config-yaml`](../config-yaml/README.md)，不进入默认 Runtime 依赖。

## 环境模型

Root 显式接收环境身份和变量层，不在 Runtime 内部读取全局 `process.env`：

```ts
const runtime = new RootRuntime({
  projectRoot,
  modules,
  environment: { name: 'staging', mode: 'production', platform: 'node' },
  environmentVariables: {
    base: process.env,
    environments: {
      staging: { API_HOST: 'staging.internal' },
    },
    plugins: {
      'root/reports': { API_HOST: 'reports.internal' },
    },
  },
});
```

每个 Plugin Scope 都提供自己的 `envStoreToken`，固定按 `base → environment.name → root/ancestor → exact owner` 合成；值为 `undefined` 的上层条目会遮蔽并删除下层值。Store 支持 `get/require`、声明式 `EnvSchema`、JSON-like `${KEY}` 展开和按 `secretKeys` 脱敏。parser 错误不会保留可能泄漏 secret 的原始 cause。

环境层在 Root 构造时复制并冻结。进程环境变化属于 process restart 边界，不通过文件 watcher 原地改变 active generation。

## HMR 粒度

| 变化 | 执行范围 |
|---|---|
| 单个能力文件 | 只 reload 对应 Capability Slot |
| child `plugin.ts` / `schema.json` | 只 shadow setup 对应 Plugin forest |
| Plugin manifest | 局部新增、删除、移动 child 或 Feature mount |
| Feature package manifest | 只重载该 provider 及其全部 owner mount |
| Feature provider 源码、未知 importer 或混合 burst | 完整 shadow generation |
| Root `plugin.ts` / `schema.json` | 请求受控 process restart |
| package ESM ABI、engine、Feature API 或 Plugin runtime | 请求受控 process restart |
| lockfile / workspace definition | 请求 process restart |

局部 prepare 仍发布完整 immutable snapshot。所有 Feature projection 都针对候选 snapshot 重建；失败时 shadow disposer 逆序执行，active generation 不变。

## Topology Transaction

`TopologyTransactionPlanner` 比较 committed graph 与重新解析的候选 graph，产出稳定的差异：

- child 新增：只 setup 新 forest，并复用 parent 与 sibling Scope。
- child 删除：从候选 snapshot 移除，旧 Scope 由旧 generation lease 延迟回收。
- child 移动：按旧 owner 删除、新 owner 新增处理；Resource 继承关系变化，因此不复用被移动 Scope。
- Feature 新增、删除、移动：只更新 owner discovery roots 与 Capability Slots，不执行 Plugin setup。
- Feature package entry 变化：重载 provider，并刷新该 package 的全部 owner mount。
- manifest 语义未变化：不发布空 generation。

候选 graph、配置、Scope、Capability 和 projection 任一步失败都会回滚新建资产。稳定 Scope 使用 `SharedLifetime` 跨 generation 复用；tree 中 retained parent 的 `children` 则会生成新的不可变视图。

## Process Restart

generation transaction 不能安全替换 Root Resource 或已挂载 package 的运行时 ABI。`RestartBoundaryPlanner` 对以下字段建立 restart fingerprint：

- package `type`、`main`、`exports`、`imports`。
- `zhin.engine`、Feature `featureApi`、Plugin `runtime`。
- Root package identity 与 Root `zhin.entry`。

HMR generation reload 可以返回升级后的 process plan，不使用异常表达控制流。Host 可只观察 `onRestartRequired`，也可以使用 `RootProcessRestartExecutor` 完成一次性受控重启：

```ts
const executor = runtime.createProcessRestartExecutor({
  async restart(plan) {
    await supervisor.replace({ reasons: plan.reasons });
  },
});

const hmr = runtime.createHmrCoordinator({
  onRestartRequired: (plan) => executor.execute(plan),
  onError: (error) => logger.error(error),
});
```

Executor 严格执行 `Root stop admission → drain snapshot leases → children-first dispose → close ModuleRuntime → Host adapter restart`，并在一个进程 incarnation 内只接受第一次请求。若 Host 只希望提示用户而不立即停止，可继续提供普通 `onRestartRequired` callback。

## Resource Handoff

普通 Resource 只需注册 disposer，并由 Scope lifetime 管理。不能双开或需要暂停 admission 的 socket、worker、Adapter Endpoint 可以在 Plugin `setup()` 或 `installResources()` 中调用 `handoff.add()`：

```ts
setup({ handoff }) {
  handoff.add({
    quiescePrevious: () => active.pause(),
    activateNext: () => shadow.bind(),
    openNext: () => shadow.open(),
    deactivateNext: () => shadow.close(),
    resumePrevious: () => active.resume(),
  });
}
```

Transaction 按 `quiescePrevious → activateNext → commit → openNext` 执行。commit 前失败会逆序 deactivate shadow、恢复 previous 并销毁候选 generation；commit 后的 `openNext` 错误通过 `onControlError` 报告。

## 关键扩展点

| API | 用途 |
|---|---|
| `ModuleRuntime` | 模块加载、失效、反向 importer closure 与 watcher port |
| `RootResourceInstaller` | 向 Root Scope 安装数据库、配置存储等共享 Resource |
| `onControlError` | 报告 commit 后 `openNext` 的不可回滚控制面错误 |
| `ConfigComposer` | 从 Plugin graph 与 Root document 生成 owner-scoped 配置 |
| `ConfigDocumentPort` | 对接带 revision 的可事务配置文档 |
| `EnvStore` / `envStoreToken` | owner-scoped 环境解析、表达式展开和 secret redaction |
| `ConfigPatchPlanner` | 校验结构化 `set/remove` patch 并计算最浅替换 forest |
| `ProjectGraphService` | 解析静态 Plugin/Feature package graph |
| `TopologyTransactionPlanner` | 比较两代 graph，计算 child/Feature 最小拓扑差异 |
| `RestartBoundaryPlanner` | 将 Root contract 与 package ABI 变化升级为 process plan |
| `RootProcessRestartExecutor` | drain/stop Root 后只调用一次 Host restart adapter |
| `InvalidationPlanner` | 将 source closure 提升为 slot/subtree/process plan |
| `HmrCoordinator` | 合并 burst、串行 invalidate/reload 与错误通知 |

## Config Patch

运行中的 document-backed Root 可以直接提交结构化配置更新，不需要伪造文件 watcher 事件：

```ts
await runtime.patchConfig([
  {
    op: 'set',
    path: ['plugins', 'reports', 'retries'],
    value: 5,
  },
  {
    op: 'remove',
    path: ['plugins', 'legacy', 'endpoint'],
  },
]);
```

Planner 先在原始 document 上应用 patch，再验证 materialized 候选并比较 owner-only ConfigView。相同值和删除不存在字段不会写文档或发布 generation；与 schema default 语义相同但原始文档发生变化的 patch 只持久化文档，不发布空 generation。多个 owner 同时变化时会折叠为最浅的不重叠 Plugin forest。使用自定义 `PluginConfigResolver` 的 Runtime 没有可写 document，因此会明确拒绝 `patchConfig()`。

当 Port 存在时，文档 commit 是 generation handoff 的最后一步：Resource 先 quiesce/activate，文件再做乐观并发检查与原子替换，最后 CAS 发布 snapshot。任一步失败都会逆序 rollback 文件、Resource 和 shadow generation。

## 安装体积

生产闭包预算为 5MB，当前只允许 Kernel、Feature Kit、AJV 与 `node-semver` 等运行时必需依赖。门禁同时拒绝 Vite、`@vitejs/*` 与 lightningcss。

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
