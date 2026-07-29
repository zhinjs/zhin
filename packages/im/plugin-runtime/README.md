# @zhin.js/plugin-runtime

Zhin Plugin-first 架构的零生产依赖底座。它定义 Plugin tree、Scope、Capability Slot、
不可变 RuntimeSnapshot、generation lease、handoff 与 RootController，不理解 IM、Agent、
配置格式、文件发现或构建工具。

```ts
import {
  createToken,
  definePlugin,
  RootController,
} from '@zhin.js/plugin-runtime';
```

`PluginSetupContext.addFeature(feature, localName, definition)` 是约定目录之外的内存
Capability 写入口。它仍由上层 Runtime 交给对应 Feature provider 校验和投影；Feature
通过 `authoring.setupMethod` 和 module augmentation 提供强类型 `addCommand`、
`addComponent`、`addTool` 等别名。底座只保存通用注册记录，不理解 IM。

## 生命周期

```text
prepare shadow state -> validate -> handoff -> atomic commit
  -> new work leases new snapshot -> old generation drains -> dispose
```

局部 HMR 只缩小 prepare/setup/dispose 范围；每次 commit 始终发布完整一致的 snapshot。
长期 socket、worker 或 admission loop 必须参加 generation handoff，不能成为模块级副作用。

本包没有生产依赖。YAML、AJV、watcher、IM 与 AI 都属于上层 adapter 或 Runtime。

验证：`pnpm --filter @zhin.js/plugin-runtime test && pnpm --filter @zhin.js/plugin-runtime build`。

详细契约见 [Kernel 与 Generation](../../../docs/architecture/target-implementation/kernel-and-generation.md)。
