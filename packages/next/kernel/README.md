# @zhin.js/next-kernel

Zhin 下一代 Plugin-first 架构的最小运行时内核。它定义稳定 identity、Plugin Scope、Capability Slot、immutable RuntimeSnapshot、generation lease 与 Root 生命周期事务，不包含 IM、Agent、文件发现、配置解析或构建工具概念。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

## 职责边界

内核负责：

- 用字符串 identity 保证 Token、Plugin、Feature 与 Capability 跨 HMR generation 稳定。
- 通过 `Scope` 建立 parent-first Resource 继承，并在装配结束后 seal。
- 通过 `DisposeStack` 和 `SharedLifetime` 管理逆序清理与跨 generation 共享所有权。
- 通过 `RuntimeSnapshot` 一次性发布 Plugin tree、配置、Resource、Capability 与 Feature projection。
- 通过 `SnapshotLease` 保证进行中的请求继续使用一致的旧 generation。
- 通过 `RootController` 串行执行 start、transaction、reload 与 stop。

内核不负责约定目录发现、manifest/schema 解析、领域 Runtime、TypeScript 编译或文件监听。

## 核心 API

| API | 用途 |
|---|---|
| `definePlugin()` | 声明纯 Plugin definition；拓扑仍由静态 manifest 决定 |
| `createToken()` / `Scope` | 定义、提供和继承 owner-scoped Resource |
| `DisposeStack` | 以严格逆序执行幂等生命周期清理 |
| `SharedLifetime` | 让未变化 Scope 被多个 generation 安全复用 |
| `createCapabilitySlot()` | 建立带 owner/source/feature identity 的能力记录 |
| `RuntimeSnapshot` | 向领域 Runtime 暴露只读 generation 数据 |
| `SnapshotStore` / `SnapshotLease` | 原子切换 snapshot，并延迟释放仍被使用的旧 generation |
| `RootController` | 串行管理整棵 Plugin tree 的生命周期事务 |

## Plugin 与 Resource

```ts
import { createToken, definePlugin } from '@zhin.js/next-kernel';

export const databaseToken = createToken<Database>('app.database');

export default definePlugin({
  name: 'reports',
  requires: [databaseToken],
  setup({ resources, lifecycle }) {
    const subscription = resources.use(databaseToken).subscribe();
    lifecycle.add(() => subscription.close());
  },
});
```

`setup()` 只做 shadow generation 的装配。长期运行的 socket、worker 或 admission loop 必须由领域 Runtime Authority 管理，或注册为 Root 可编排的 generation handoff；不能成为脱离生命周期的模块级副作用。

## Generation 语义

```text
prepare shadow state
  -> validate
  -> atomic commit
  -> new work leases new snapshot
  -> old work releases old lease
  -> old generation disposes
```

“局部 HMR”描述 prepare/setup/dispose 的范围。每次 commit 仍发布一份完整且内部一致的 `RuntimeSnapshot`，不会原地修改 Map 或运行中的请求。

## 依赖规则

该包没有生产依赖。任何 Feature、IM、Agent、Console、文件系统或编译器依赖都必须位于上层包。

## 开发验证

```bash
pnpm --filter @zhin.js/next-kernel test
pnpm --filter @zhin.js/next-kernel build
```

## 相关文档

- [Kernel 与 Generation](../../../docs/architecture/target-implementation/kernel-and-generation.md)
- [TypeScript HMR Plugin Kernel ADR](../../../docs/adr/0044-typescript-hmr-plugin-kernel.md)
- [Next 架构总览](../README.md)
