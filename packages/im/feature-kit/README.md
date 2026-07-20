# @zhin.js/feature-kit

Feature Provider 的公共契约与 owner-aware Capability 发现器。Feature 包通过它定义目录约定、definition 校验、Runtime projection 和可选构建计划，而不需要修改 Kernel。

本包是自定义 Feature provider 的正式公共接口。领域 Feature 依赖它，Kernel 不反向依赖。

## 处理管线

```text
Plugin package root
  -> SourceConvention.discover
  -> SourceConvention.load
  -> FeatureAuthoring.validate
  -> CapabilitySlot
  -> FeatureRuntime.project
  -> generation-scoped projection
```

Command、Middleware、Component、Tool、Skill、Agent、Page 等都应是独立 Feature，而不是 Kernel 中的硬编码枚举。

## 核心 API

| API | 用途 |
|---|---|
| `defineFeatureProvider()` | 校验并冻结 Feature provider contract |
| `SourceConvention` | 定义约定目录、文件筛选、加载方式与 server/client target |
| `FeatureDiscovery` | 按 Plugin owner 扫描、校验并生成稳定 Capability Slot |
| `FeatureCatalog` | 在一个 generation 内检测 Feature provider identity 冲突 |
| `FeatureRuntime.project()` | 从 Slot 构造只读索引、matcher 或 manifest 等派生物 |
| `FeatureBuildAdapter` | 将 source 映射为可选构建产物计划 |
| `typeScriptModules()` | 发现普通递归 `*.ts`/可选 `*.tsx` 目录并加载 default export |
| `createCapabilityContext()` | 从 immutable snapshot 建立 owner/config/resource 执行上下文 |
| `OwnerCapabilityIndex` | nearest-owner resolve、visible view 与稳定 qualified name |

## 定义 Feature

```ts
import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider } from '@zhin.js/feature-kit';

export default defineFeatureProvider({
  protocol: 1,
  id: featureId('acme.task'),
  authoring: {
    conventions: [taskFiles],
    validate: (value, context) => parseTask(value, context.source),
  },
  runtime: {
    project: (slots, { snapshot }) => ({
      value: TaskIndex.create(slots, snapshot),
    }),
  },
});
```

Provider 本身应是纯 definition。`project()` 只能建立 generation-scoped 派生物，不能写入模块级 registry；若 projection 持有资源，必须返回 `dispose`。

Projection 也可以返回 generation `handoff` participant。Runtime 将它排在 Plugin Resource handoff 之后激活、之前 quiesce，使 Endpoint 等 Feature 派生资源参与同一个 generation transaction；prepare 阶段仍不得开放 admission。

普通 TypeScript 目录约定与 execution context 由 Feature Kit 复用，但文件语义、definition brand、排序和执行仍归具体 Feature 所有。Command、Middleware、Component 因此不需要复制扫描器和 Resource lookup，也不会把领域枚举塞回 Kernel。

`typeScriptModules({ recursive: false })` 用于 Tool/MCP 这类一级目录；默认仍递归。`OwnerCapabilityIndex` 只表达 Plugin tree 继承，不知道 Tool、Skill、Agent 等领域枚举。

## Identity 与冲突

- Capability identity 为 `(owner PluginId, FeatureId, localName)`。
- 同一 package 可挂载为多个 Plugin instance，因此冲突按 owner 隔离。
- 同一 owner 下重复 local name 或重复 source 会使整个 shadow generation 失败。
- 选择性 HMR 仍枚举完整目录用于冲突检查，但只 load 被选择的 definition。

## Host Port

`DiscoveryHost` 是唯一 I/O 边界：`list()` 枚举目录，`loadModule()` 加载 Server TS/JS 模块，`readText()` 加载 Markdown/JSON 文本。可选 `loadClientModule()` 只返回 Page/Layout 等浏览器源码的静态 build artifact，不得在 Node 中执行它们。生产使用预编译 ESM host；开发期可选择 Runtime 内的 Node 原生 TS/watcher adapter。Client compiler 仍是独立 adapter，Node 不执行 TSX。

## 依赖规则

本包只依赖 `@zhin.js/plugin-runtime`。具体 Feature 可以依赖 Feature Kit 与 Kernel，但 Kernel 不得反向依赖任何 Feature。

## 开发验证

```bash
pnpm --filter @zhin.js/feature-kit test
pnpm --filter @zhin.js/feature-kit build
```

## 相关文档

- [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)
- [Config、Discovery 与 HMR](../../../docs/architecture/target-implementation/config-discovery-hmr.md)
- [Plugin-first 目标架构](../../docs/target-architecture.md)
