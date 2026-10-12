# @zhin.js/schema

Zhin.js 的配置验证和 Schema 系统，提供类型安全的配置定义、验证和序列化能力。

## 安装

```bash
pnpm add @zhin.js/schema
```

## 基本用法

### 创建 Schema

使用静态工厂方法创建不同类型的 Schema：

```typescript
import { Schema } from '@zhin.js/schema'

// 基础类型
const strSchema = Schema.string()
const numSchema = Schema.number()
const boolSchema = Schema.boolean()
const regSchema = Schema.regexp()
const dateSchema = Schema.date()
const anySchema = Schema.any()
```

### 对象 Schema

```typescript
const configSchema = Schema.object({
  port: Schema.number().default(8080).description('服务端口'),
  host: Schema.string().default('localhost').description('服务地址'),
  debug: Schema.boolean().default(false).description('调试模式'),
})

// 验证并填充默认值
const config = configSchema({ port: 3000 })
// => { port: 3000, host: 'localhost', debug: false }
```

### 链式配置

```typescript
Schema.number()
  .required()           // 标记为必填
  .default(8080)        // 设置默认值
  .description('端口')  // 添加描述
  .min(1)               // 最小值
  .max(65535)            // 最大值
  .step(1)              // 步长
  .hidden()             // 在表单中隐藏
```

### 复合类型

```typescript
// 列表
const listSchema = Schema.list(Schema.string())

// 字典
const dictSchema = Schema.dict(Schema.number())

// 元组
const tupleSchema = Schema.tuple([
  Schema.string(),
  Schema.number(),
])

// 联合类型
const unionSchema = Schema.union([
  Schema.const('a'),
  Schema.const('b'),
  Schema.const('c'),
])

// 交叉类型
const intersectSchema = Schema.intersect([
  Schema.object({ name: Schema.string() }),
  Schema.object({ age: Schema.number() }),
])
```

### 选项列表

```typescript
Schema.union([
  Schema.const('sqlite'),
  Schema.const('mysql'),
  Schema.const('postgres'),
]).description('数据库类型')
```

## 序列化

Schema 支持 JSON 序列化，便于在网络传输或持久化：

```typescript
// 序列化为 JSON
const json = schema.toJSON()

// 从 JSON 恢复
const restored = Schema.fromJSON(json)
```

## 自定义类型扩展

通过 `Schema.extend()` 注册自定义类型格式化器：

```typescript
Schema.extend('myType', function (this: Schema, key: string, value: any) {
  value = Schema.checkDefault(this, key, value)
  // 自定义验证和转换逻辑
  return value
})
```

使用 `Schema.resolve()` 获取已注册的格式化器：

```typescript
const formatter = Schema.resolve('number')
```

## 与 Zhin.js 集成

Plugin Runtime 可以直接使用同一份声明推导类型、生成标准 JSON Schema、校验配置、填充默认值并向 Console 提供表单元信息：

```typescript
import { definePlugin, Schema } from 'zhin.js'

const configSchema = Schema.object({
  interval: Schema.number().min(1).default(300).description('轮询间隔，秒').effect('reload'),
  enabled: Schema.boolean().default(true),
  apiKey: Schema.string().required().secret().component('password'),
  label: Schema.string(),
})

type Config = Schema.Output<typeof configSchema>
// interval、enabled、apiKey 为必有字段；label 为 string | undefined。

export default definePlugin({
  name: 'subscription',
  config: configSchema,
  setup({ config }) {
    const current = config.get() // 自动推导 Config，不再手写泛型
    console.log(current.interval, current.enabled)
  },
})
```

应用配置的密钥仍使用环境引用：

```yaml
plugins:
  subscription:
    apiKey: ${SUBSCRIPTION_API_KEY}
```

`secret()` 声明仅用于表单和数据处理提示，不储存密钥、也不负责读取环境变量；它会导出标准 `writeOnly: true` 与 `x-zhin-config.secret` 元信息，并拒绝密钥默认值。环境展开和配置校验由现有 Runtime 完成。`.effect('reload')` 表明插件更新后重载；系统配置的进程重启由 Root Host 决定。

`schema.toJsonSchema()` 返回标准 JSON Schema 2020-12；默认值、范围、枚举、描述与 `x-zhin-config` 表单提示均从同一声明生成。Runtime 的现有校验器负责校验与默认值，不增加第二套配置引擎。对象默认不接受未知属性；字典使用 `Schema.dict()`。配置只能使用 JSON 值；业务 `date/regexp` 无法导出为配置契约。

这份内联声明适用于 trusted 插件；isolated 插件保持根目录 `schema.json`，Host 不执行其入口。单个插件不能同时声明 `config` 与 `schema.json`，避免两个来源漂移。`schema.json` 仍支持只有 JSON 配置契约的插件。

插件配置当前必须是声明了 `properties` 的对象根。Console 支持基础嵌套对象、列表、字典及字段元信息；`union`、`intersect`、`tuple` 可以导出标准校验契约，但组合类型和 `$ref` 的完整表单编辑仍需独立 Console 前端协同验收，当前 Console 对不支持的形态明确报错。

现有业务输入解析和 `schema.toJSON()` / `Schema.fromJSON()` 保持各自的内部序列化格式；使用标准配置契约请调用 `.toJsonSchema()`。

## 工具函数

- `isEmpty(value)` - 检查值是否为空（`undefined`、`null`、空字符串、空数组、空对象）
- `deepMerge(target, source)` - 深度合并对象

## API 参考

### 静态方法

| 方法 | 说明 |
|------|------|
| `Schema.number()` | 创建数字类型 Schema |
| `Schema.string()` | 创建字符串类型 Schema |
| `Schema.boolean()` | 创建布尔类型 Schema |
| `Schema.regexp()` | 创建正则表达式类型 Schema |
| `Schema.date()` | 创建日期类型 Schema |
| `Schema.dict(inner)` | 创建字典类型 Schema |
| `Schema.object(props)` | 创建对象类型 Schema |
| `Schema.list(inner)` | 创建列表类型 Schema |
| `Schema.tuple(items)` | 创建元组类型 Schema |
| `Schema.union(types)` | 创建联合类型 Schema |
| `Schema.intersect(types)` | 创建交叉类型 Schema |
| `Schema.const(value)` | 创建常量类型 Schema |
| `Schema.any()` | 创建任意类型 Schema |
| `Schema.extend(type, formatter)` | 注册自定义类型格式化器 |
| `Schema.resolve(type)` | 获取已注册的格式化器 |
| `Schema.fromJSON(json)` | 从 JSON 恢复 Schema 实例 |

### 实例方法

| 方法 | 说明 |
|------|------|
| `.required()` | 标记为必填字段 |
| `.hidden()` | 在表单中隐藏 |
| `.description(text)` | 添加字段描述 |
| `.default(value)` | 设置默认值 |
| `.option(label, value)` | 添加可选项 |
| `.multiple()` | 允许多选 |
| `.min(value)` | 设置最小值 |
| `.max(value)` | 设置最大值 |
| `.step(value)` | 设置步长 |
| `.component(name)` | 指定渲染组件 |
| `.toJSON()` | 业务 Schema 的内部序列化 |
| `.toJsonSchema()` | 导出标准配置 JSON Schema |
| `.secret()` | 密钥表单元信息，配置继续使用环境引用 |
| `.effect('reload')` | 配置生效方式提示 |

## License

MIT
