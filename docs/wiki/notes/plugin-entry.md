---
title: 能力该写在哪里？
---

# 一个能力该写进约定目录，还是 `plugin.ts`？

**先看能力是否需要与别的能力共享资源和生命周期。** 独立的命令、中间件、组件或工具放在约定目录；需要统一创建资源、注册清理函数或按配置决定提供哪些能力时，用 `plugin.ts` 的 `setup()`。

这条选择适用于插件作者。它不改变安装拓扑：插件和 Feature 仍由 `package.json#zhin` 声明，配置值放在 `zhin.config.yml`。

## 一个能力：用目录

```text
my-plugin/
├── plugin.ts
└── commands/
    └── hello/
        └── index.ts
```

`commands/hello/index.ts` 是一个命令入口；其他代码能力通常使用 `<name>/index.ts`。文件旁的 helper 不会被当成第二个能力入口。修改独立能力时，Runtime 可以按能力重载。

## 需要共享资源：用 setup

在 `plugin.ts` 默认导出的 `definePlugin({ setup(context) { ... } })` 中，通过 `context.resources` 获取 Host 服务，用 `context.lifecycle.add()` 登记资源清理，并用 `context.addCommand()` 等方法注册能力。可选资源先用 `has(token)` 判断。

同一种能力只选一个入口：如果目录和 `setup()` 在同一 owner 下注册同名能力，Runtime 会报重复，而不是选一个覆盖另一个。只有确实要为生态新增一种能力类型时，才需要写 Feature 包。

具体目录与命名规则见[约定目录](/authoring/conventions)；`setup()` 的资源、依赖和生命周期见[definePlugin](/authoring/define-plugin)。
