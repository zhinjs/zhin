# @zhin.js/next-feature-kit

Feature Provider 的公共契约与 owner-aware Capability 发现器。Feature 包通过它定义目录约定、definition 校验、Runtime projection 和可选构建计划，而不需要修改 Kernel。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

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

## 定义 Feature

```ts
import { featureId } from '@zhin.js/next-kernel';
import { defineFeatureProvider } from '@zhin.js/next-feature-kit';

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

普通 TypeScript 目录约定与 execution context 由 Feature Kit 复用，但文件语义、definition brand、排序和执行仍归具体 Feature 所有。Command、Middleware、Component 因此不需要复制扫描器和 Resource lookup，也不会把领域枚举塞回 Kernel。

## Identity 与冲突

- Capability identity 为 `(owner PluginId, FeatureId, localName)`。
- 同一 package 可挂载为多个 Plugin instance，因此冲突按 owner 隔离。
- 同一 owner 下重复 local name 或重复 source 会使整个 shadow generation 失败。
- 选择性 HMR 仍枚举完整目录用于冲突检查，但只 load 被选择的 definition。

## Host Port

`DiscoveryHost` 是唯一 I/O 边界：`list()` 枚举目录，`loadModule()` 加载 TS/JS 模块，`readText()` 加载 Markdown/JSON 文本。默认 Runtime 可提供预编译 ESM host；开发期 transform 和 watcher 应由独立 adapter 实现。

## 依赖规则

本包只依赖 `@zhin.js/next-kernel`。具体 Feature 可以依赖 Feature Kit 与 Kernel，但 Kernel 不得反向依赖任何 Feature。

## 开发验证

```bash
pnpm --filter @zhin.js/next-feature-kit test
pnpm --filter @zhin.js/next-feature-kit build
```

## 相关文档

- [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)
- [Config、Discovery 与 HMR](../../../docs/architecture/target-implementation/config-discovery-hmr.md)
- [Next 架构总览](../README.md)
