# 重构前后对照示例

这个示例用于回答：一个旧插件如果把命令、数据库、定时任务、路由全堆在一个文件里，重构后应该怎样拆。

## 重构前：单文件堆叠

```text
src/
  index.ts
```

典型问题：

- 顶部声明配置
- 中间定义数据库模型
- 后面混着命令、定时任务、HTTP 路由
- 文件越来越长，新增功能时容易重复读取配置和数据库

常见坏味道：

- 一个文件超过数百行
- 每个命令都自己查数据库、拼相同返回格式
- `useContext('database')`、`useContext('router')`、`addCron()` 都写在一起

## 重构后：按职责拆开

```text
src/
  index.ts
  commands/
    index.ts
    feed.ts
  crons/
    index.ts
  services/
    database.ts
    http.ts
    feed.ts
  models/
    index.ts
```

## 一个典型迁移方式

### 旧入口里原本同时做这些事

1. `declareConfig()`
2. `defineModel()` 或 `db.define()`
3. `useContext('database', ...)`
4. 多个 `addCommand()`
5. `addCron(new Cron(...))`
6. `useContext('router', ...)`

### 新结构里推荐这样放

1. `src/index.ts`
内容：
- `usePlugin()`
- `declareConfig()`
- 导入 `commands/index.js`
- 导入 `crons/index.js`
- `useContext('database', ...)` 时挂载数据库服务逻辑
- `useContext('router', ...)` 时挂载 HTTP 服务逻辑

2. `src/models/index.ts`
内容：
- 表定义
- `registerPluginModels()`

3. `src/services/database.ts`
内容：
- 获取 model
- 查询、写入、聚合等共享数据逻辑

4. `src/commands/feed.ts`
内容：
- 只保留命令入口和参数处理
- 真正的数据读写调用 `services/database.ts` 或 `services/feed.ts`

5. `src/crons/index.ts`
内容：
- 注册定时任务
- 周期表达式来自配置

6. `src/services/http.ts`
内容：
- 路由注册逻辑

## 一条具体迁移规则

如果一段代码既依赖配置，又依赖数据库，还要被多个命令复用：

- 不要继续留在命令文件里
- 优先移到 `services/`

如果一段代码只是命令参数解析和响应文案：

- 保留在 `commands/`

如果一段代码只是定时触发调度：

- 放到 `crons/`

## 不该这样拆

错误示例：

- 把每个命令都拆成一个目录，但逻辑仍然互相复制
- 把模型定义散落到多个命令文件里
- 入口文件依然保留所有 `useContext()` 里的业务细节

## 判断是否重构成功

重构后应当满足：

- 入口文件主要负责装配
- 共享业务逻辑从命令中抽离
- 数据模型定义集中可见
- Cron、Router、Web 等能力各自归位
- 行为与用户入口基本不变