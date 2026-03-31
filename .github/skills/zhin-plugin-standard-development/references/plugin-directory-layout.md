# 插件目录骨架参考

这个参考文件用于回答“当前插件应该拆成什么目录结构”以及“哪些目录是必需的，哪些是按需添加的”。

## 目标原则

- 目录结构服务于职责边界，而不是为了看起来完整
- 先最小，再按能力扩展，不预建大量空目录
- 入口文件负责装配，不负责塞满所有业务实现

## 方案 1：最小单文件插件

适用情况：

- 只有少量命令或一个简单中间件
- 没有数据库、router、web 页面
- 不存在明显重复逻辑

推荐结构：

```text
src/
  index.ts
```

通常放什么：

- `usePlugin()`
- `declareConfig()`
- `addCommand()`
- `addMiddleware()`

不建议现在就加：

- `commands/`
- `services/`
- `client/`

## 方案 2：模块化服务端插件

适用情况：

- 有多个命令、中间件、事件、定时任务或数据库逻辑
- 已经出现职责混杂和重复实现

推荐结构：

```text
src/
  index.ts
  commands/
    index.ts
    admin.ts
    query.ts
  middlewares/
    index.ts
  events/
    index.ts
  crons/
    index.ts
  services/
    database.ts
    http.ts
  models/
    index.ts
```

目录说明：

- `index.ts`：入口装配
- `commands/`：聊天命令
- `middlewares/`：消息中间件
- `events/`：事件监听与发送钩子
- `crons/`：周期任务
- `services/`：数据库、HTTP、外部 SDK、共享业务逻辑
- `models/`：模型定义与注册

## 方案 3：带控制台前端的插件

适用情况：

- 需要控制台设置页、监控页或插件前端面板

推荐结构：

```text
src/
  index.ts
  commands/
  services/
  models/
client/
  index.tsx
  pages/
  components/
```

目录说明：

- 服务端仍然由 `src/index.ts` 装配
- `client/` 独立承载 React 页面
- 不要把页面组件放回服务端 `src/`

## 方案 4：带 AI 工具的插件

适用情况：

- 插件同时提供命令和 AI 可调用能力
- 或者插件只面向 AI 提供工具，不需要普通命令

推荐结构：

```text
src/
  index.ts
  tools/
    index.ts
    query.ts
  services/
    provider.ts
```

说明：

- `tools/` 放 `ZhinTool` 定义和装配
- 复杂工具实现放 `services/`

## 目录不是越全越好

出现以下情况时，不要盲目加目录：

- 只有一个命令却先拆出 `commands/index.ts` + `commands/foo.ts`
- 没有前端却提前建 `client/`
- 没有模型却提前建 `models/`
- 没有周期任务却提前建 `crons/`

## 快速选择法

1. 需求很小：单文件结构
2. 多命令或多能力并存：模块化服务端插件
3. 需要控制台页面：模块化服务端插件 + `client/`
4. 需要 AI 工具：在模块化结构上补 `tools/`

## 与重构工作流的边界

如果你面对的不是“新建结构”，而是“已有插件怎么迁移到更合理的结构”，应该使用 `zhin-plugin-refactoring` skill，而不是只参考本文件硬拆。