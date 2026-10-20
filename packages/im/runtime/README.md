# @zhin.js/runtime

Zhin.js Plugin 树的 Root 生命周期权威。它从 `configVersion: 2` 应用声明创建 Root 直接实例，
从包 manifest 读取 Feature/API 契约，按 owner 组合 schema/config/env，通过 Feature provider 发现 capability，并用
immutable snapshot、CAS generation 与 lease 驱动局部 HMR。

```ts
import { EsmModuleRuntime, RootRuntime } from '@zhin.js/runtime';

const runtime = new RootRuntime({
  projectRoot: process.cwd(),
  modules: new EsmModuleRuntime(),
  config: { configVersion: 2, plugins: {} },
  environment: { name: 'development', mode: 'development', platform: 'node' },
});

await runtime.start();
```

`plugins` 是实例名到包引用的映射；业务配置放在顶层同名块，停用实例列在 `disable_plugins`。
Root 自身配置仍放在 `plugin`。缺少版本标记或 Root 包仍含非空 `zhin.plugins` 时会拒绝启动，
迁移步骤见 [插件实例声明迁移](../../../docs/migrations/plugin-instance-declarations.md)。
自定义 `config` resolver 通过 `application` 选项提供同一 v2 应用声明，不从包清单推断实例。

## 事务边界

- capability 文件变化只 prepare 对应 Slot。
- child/schema 变化替换最浅受影响 subtree。
- 应用声明拓扑事务支持 Root 实例新增、删除和重排；Feature 挂载变更仍由包 manifest 驱动。
- Root/package ABI、lockfile 和未知 importer 变化升级为 process restart。
- 外部 Root 配置按实际投影分类：子 Plugin 配置只替换对应 subtree，Host 配置请求
  process restart。
- `.env` / `.env.<environment>` 由 `EnvironmentLayersPort` 重读；Runtime 重新展开配置引用，
  Host 投影变化时重启进程，否则提交新的 Plugin generation。
- 候选校验或 handoff 失败不提交 generation；旧 snapshot 保持可用。
- 最后一个旧 lease 释放后，旧资源才按 children-first 顺序回收。

Runtime 不静态导入 Command、Agent、Page 或 Adapter provider。具体能力由插件 manifest
动态装配。Ajv 用于整树 schema 校验，semver 用于 engine/Feature API admission；它们只
属于显式安装的 Root 控制面，不进入 `zhin.js` 默认 IM 安装。

`zhin.js/runtime` 是指向本包的 optional-peer facade。新项目应显式安装本包；这保证
`zhin.js` 默认 IM 闭包继续满足 10MB 门禁。

```bash
pnpm --filter @zhin.js/runtime build
pnpm --filter @zhin.js/runtime test
pnpm --filter @zhin.js/runtime check:size
```


## 配置解释的证据边界

`PrimaryConfig.compositionMode` 由 RootRuntime 实际执行的配置合成分支记录为
`document` 或 `custom`；没有标记的旧 authority 视为 `unknown`。它随原有
PrimaryConfig generation 资源提交、保留和回滚，不记录配置值的历史来源。
`createPrimaryConfig()` 未指定模式时使用 `unknown`，不能根据值相等推断模式。
插件的最终 ConfigView 以同一 snapshot 的 `config.get(owner)` 为准；
PrimaryConfig.expanded 使用 Root EnvStore，不能用其中的子段替代 child owner 的环境覆盖。
