# 重构前后对照示例

这个示例说明怎样把命令、数据库、调度和 HTTP 路由混在一起的旧插件迁入当前 Plugin Runtime。

## 重构前：单文件命令式注册

```text
src/
  index.ts
```

常见问题：入口同时声明配置、取得 Host、定义表、注册命令和定时器；业务逻辑重复；监听器与任务没有明确清理路径。

## 重构后：约定目录 + owner Resource

```text
plugin.ts
schema.json
commands/
  feed/
    index.ts
handlers/
  message-receive/
    index.ts
hooks/
  before-send/
    index.ts
schedules/
  refresh-feed/
    index.ts
pages/
  dashboard/
    index.tsx
src/
  models/feed.ts
  services/feed.ts
```

`plugin.ts` default-export `definePlugin()`，只做装配：读取 `context.config.get()`，通过
`context.resources.has/use()` 取得 `databaseHostToken`、`httpHostToken` 或
`scheduleHostToken`，并将共享服务 `provide()` 为 owner Resource。每个订阅、路由或任务都把 disposer
交给 `context.lifecycle.add()` 或从 `setup()` 返回。

`commands/feed/index.ts` default-export `defineCommand()`，只负责参数和响应；通过执行上下文的
`context.use(feedServiceToken)` 调用共享服务。它不使用 `context.resources`，也不 import 模块级可变单例。

事件、Hook、Schedule、Console 页面分别进入对应的命名目录。Console 页面默认导出 React 组件，并
命名导出 `meta = definePage(...)`。复杂数据访问与外部 SDK 仍可放在 `src/services/`，但它们由 owner
装配，不自行注册运行时能力。

## 判断是否成功

- `plugin.ts` 只包含装配、Resource 与生命周期。
- 每个能力位于 `<kind>/<name>/index.ts(x)`，且只有一个默认导出定义。
- 配置 key、命令路由、模型名、HTTP 路径和用户可见行为保持不变。
- generation 回滚后没有旧 listener、timer、socket 或路由残留。
- `pnpm check:plugin-capability-publish` 与相关 authoring boundary 门禁通过。
