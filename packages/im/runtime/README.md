# @zhin.js/runtime

Zhin.js Plugin 树的 Root 生命周期权威。它从静态 package manifest 构建 Plugin instance
tree，按 owner 组合 schema/config/env，通过 Feature provider 发现 capability，并用
immutable snapshot、CAS generation 与 lease 驱动局部 HMR。

```ts
import { EsmModuleRuntime, RootRuntime } from '@zhin.js/runtime';

const runtime = new RootRuntime({
  projectRoot: process.cwd(),
  modules: new EsmModuleRuntime(),
  environment: { mode: 'development' },
});

await runtime.start();
```

## 事务边界

- capability 文件变化只 prepare 对应 Slot。
- child/schema 变化替换最浅受影响 subtree。
- manifest topology transaction 支持 child/Feature 新增、删除和移动。
- Root/package ABI、lockfile 和未知 importer 变化升级为 process restart。
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
