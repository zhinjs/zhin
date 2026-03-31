# 数据建模参考

这个参考文件用于回答“插件接数据库时，模型应该先怎么定义，再怎么使用”。

## 推荐顺序

1. 先决定表名与行结构
2. 写出 `Definition<T>`
3. 在插件启动装配阶段注册模型
4. 等 `database` Context 就绪后再获取 model 并挂命令或服务

## 两种常见建模方式

### 方式 1：通过 root 或 plugin 的 `defineModel()` 预注册

适用情况：

- 你要把模型定义和使用分离
- 插件较大，准备把模型单独放进 `models/`
- 想让模型注册更接近框架或大型插件的组织方式

推荐起步文件：

- [模型定义骨架](../assets/model-definition-template.ts)

基本步骤：

1. 定义行接口，例如 `ProfileRow`
2. 定义 `Definition<ProfileRow>`
3. 写一个 `registerPluginModels()`，在里面调用 `defineModel()`
4. 在插件入口里尽早调用模型注册逻辑
5. 在 `useContext('database', ...)` 里通过 `db.models.get(name)` 获取 model

### 方式 2：在 `database` Context 就绪后直接 `db.define()`

适用情况：

- 示例插件或实验性功能
- 模型很少，而且不想单独拆 `models/` 文件

仓库里的真实示例可参考 [examples/test-bot/src/plugins/test-plugin.ts](examples/test-bot/src/plugins/test-plugin.ts#L544)

这种方式的顺序是：

1. `useContext('database', async (db) => { ... })`
2. 在回调里 `db.define('table_name', definition)`
3. 再通过 `db.models.get('table_name')` 取得 model

## 选型建议

- 正式插件、可维护插件：优先 `defineModel()` 预注册
- 小型示例、一次性试验：可以直接 `db.define()`

## 模型设计注意点

- 主键通常使用 `integer` + `primary: true` + `autoIncrement: true`
- 用户关联字段更适合单独保留 `user_id: text`
- 数字状态字段优先 `integer`
- 结构化扩展字段可用 `json`
- 不要把消息对象、插件实例等运行时对象直接塞进模型字段

## 使用模型时的注意点

- 先确认 `db.models.get(name)` 真的拿到了 model
- 查询逻辑不要在命令回调里无限膨胀，复杂逻辑抽到 service
- 模型定义变动后，注意现有数据库兼容和迁移问题

## 推荐搭配

完整路径通常是：

1. [模型定义骨架](../assets/model-definition-template.ts)
2. [数据库服务骨架](../assets/database-service-template.ts)
3. [模块化插件入口骨架](../assets/modular-plugin-entry-template.ts)