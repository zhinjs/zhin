# 数据建模参考

这个参考文件用于回答“插件接数据库时，模型应该先怎么定义，再怎么使用”。

## 推荐顺序

1. 先决定表名与行结构
2. 写出明确的行类型和表定义对象
3. 在插件启动装配阶段注册模型
4. 在 `setup(context)` 中解析 `databaseHostToken`，定义表并提供 owner Resource

## 两种常见建模方式

### 方式 1：拆出纯表定义函数

适用情况：

- 你要把模型定义和使用分离
- 插件较大，准备把模型单独放进 `models/`
- 想让模型注册更接近框架或大型插件的组织方式

推荐起步文件：

- [模型定义骨架](../assets/model-definition-template.ts)

基本步骤：

1. 定义行接口，例如 `ProfileRow`
2. 定义 `Definition<ProfileRow>`
3. 写一个 `definePluginTables(db)`，在里面调用 `db.define()`
4. 在 `plugin.ts` 的 `setup(context)` 里先 `has(databaseHostToken)`，再 `context.resources.use(databaseHostToken)`
5. 定义表后创建 store，并用 `context.resources.provide(storeToken, store)` 暴露给能力

### 方式 2：在 `setup(context)` 中直接 `db.define()`

适用情况：

- 示例插件或实验性功能
- 模型很少，而且不想单独拆 `models/` 文件

仓库里的真实示例可参考 `plugins/utils/lottery/plugin.ts` 与 `plugins/utils/lottery/src/db.ts`。

这种方式的顺序是：

1. 在 `setup(context)` 中确认 `context.resources.has(databaseHostToken)`
2. 通过 `context.resources.use(databaseHostToken)` 取得 Host
3. 调用 `db.define('table_name', definition)`，再通过 `db.models.get('table_name')` 取得 model
4. 能力文件通过 `context.use(storeToken)` 使用数据能力，不 import 模块级可变单例

## 选型建议

- 正式插件、可维护插件：优先拆出纯表定义函数与 store Resource
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
