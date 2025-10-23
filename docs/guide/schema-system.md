# Schema 配置系统使用指南

Zhin.js 现在支持基于 Schema 的配置系统，可以方便地定义、验证和管理插件配置。

## 特性

- ✅ 类型安全的配置定义
- ✅ 自动验证和默认值
- ✅ 支持复杂的嵌套结构
- ✅ Web 端可视化配置管理
- ✅ 热重载配置更新

## Schema 类型

支持的基础类型：
- `string` - 字符串
- `number` - 数字
- `boolean` - 布尔值
- `date` - 日期
- `regexp` - 正则表达式
- `percent` - 百分比 (0-1)

复杂类型：
- `object` - 对象
- `list` / `array` - 列表
- `dict` - 字典
- `tuple` - 元组
- `union` - 联合类型
- `intersect` - 交叉类型
- `const` - 常量
- `any` - 任意类型
- `never` - 空类型

## 使用方法

### 1. 定义插件 Schema

```typescript
import { Schema } from 'zhin.js';
import { usePlugin, onMounted } from 'zhin.js';

// 定义配置 Schema
const MyPluginSchema = Schema.object({
  enabled: Schema.boolean('enabled')
    .default(true)
    .description('是否启用插件'),
  
  apiKey: Schema.string('apiKey')
    .required()
    .description('API 密钥'),
  
  maxRetries: Schema.number('maxRetries')
    .default(3)
    .min(1)
    .max(10)
    .description('最大重试次数'),
  
  timeout: Schema.number('timeout')
    .default(5000)
    .min(100)
    .description('超时时间（毫秒）'),
  
  features: Schema.list(Schema.string(), 'features')
    .default(['feature1', 'feature2'])
    .description('启用的功能列表')
});

// 应用 Schema
const plugin = usePlugin();
(plugin.constructor as any).schema = MyPluginSchema;

// 使用配置
onMounted(() => {
  const config = plugin.getConfig();
  console.log('当前配置:', config);
  
  // 监听配置变化
  plugin.on('config.changed', (newConfig) => {
    console.log('配置已更新:', newConfig);
  });
});
```

### 2. 在配置文件中提供配置

在 `zhin.config.ts` 中添加插件配置：

```typescript
export default defineConfig({
  // 全局配置
  log_level: LogLevel.INFO,
  debug: false,
  plugins: ['my-plugin'],
  
  // 插件配置
  'my-plugin': {
    enabled: true,
    apiKey: 'your-api-key',
    maxRetries: 5,
    timeout: 10000,
    features: ['feature1', 'feature3']
  }
});
```

### 3. 通过 API 管理配置

#### 获取所有 Schema

```bash
GET /api/schemas
```

响应：
```json
{
  "success": true,
  "data": {
    "app": { ... },
    "my-plugin": { ... }
  },
  "total": 2
}
```

#### 获取特定插件的 Schema

```bash
GET /api/schemas/my-plugin
```

响应：
```json
{
  "success": true,
  "data": {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true,
        "description": "是否启用插件"
      },
      ...
    }
  }
}
```

#### 获取插件配置

```bash
GET /api/config/my-plugin
```

响应：
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "apiKey": "your-api-key",
    "maxRetries": 5,
    ...
  }
}
```

#### 更新插件配置

```bash
POST /api/config/my-plugin
Content-Type: application/json

{
  "maxRetries": 10,
  "timeout": 15000
}
```

响应：
```json
{
  "success": true,
  "message": "Plugin my-plugin configuration updated successfully",
  "data": {
    "enabled": true,
    "maxRetries": 10,
    "timeout": 15000,
    ...
  }
}
```

## Schema 链式 API

Schema 支持链式调用来配置验证规则：

```typescript
Schema.string()
  .required()           // 必填
  .default('default')   // 默认值
  .min(1)              // 最小长度
  .max(100)            // 最大长度
  .description('描述')  // 说明文字
  .hidden()            // 在 UI 中隐藏
  .component('input')  // 指定 UI 组件

Schema.number()
  .required()
  .default(0)
  .min(0)              // 最小值
  .max(100)            // 最大值
  .step(1)             // 步长

Schema.list(Schema.string())
  .default([])
  .minItems(1)         // 最少元素数
  .maxItems(10)        // 最多元素数

Schema.object({...})
  .required()
  .default({})
```

## App 配置 Schema

App 本身也有 Schema 定义：

```typescript
const AppConfigSchema = Schema.object({
  log_level: Schema.number('log_level')
    .default(LogLevel.INFO)
    .min(0)
    .max(4),
  
  plugin_dirs: Schema.list(Schema.string())
    .default(['./plugins', 'node_modules']),
  
  plugins: Schema.list(Schema.string())
    .default([]),
  
  debug: Schema.boolean()
    .default(false)
});
```

可以通过 API 获取和更新：

```bash
# 获取 App Schema
GET /api/schemas/app

# 获取 App 配置
GET /api/config/app

# 更新 App 配置
POST /api/config/app
```

## 配置验证

Schema 系统会自动验证配置：

1. **类型检查** - 确保值类型正确
2. **范围检查** - 检查 min/max 限制
3. **必填检查** - 检查 required 字段
4. **默认值** - 自动应用默认值

如果配置无效，会抛出错误：

```typescript
// 错误示例
{
  maxRetries: 100  // 超出 max(10) 限制
}
// 抛出: Error: maxRetries is too large

{
  apiKey: ''  // required 字段为空
}
// 抛出: Error: apiKey is required
```

## 配置热重载

配置更新后会自动触发事件：

```typescript
plugin.on('config.changed', (newConfig) => {
  // 处理配置变化
  console.log('配置已更新:', newConfig);
  
  // 重新初始化服务
  reinitializeService(newConfig);
});
```

## 完整示例

参见 `test-bot/src/plugins/example-schema.ts` 获取完整示例。

## 最佳实践

1. **使用描述性的配置键名**
   ```typescript
   Schema.string('apiEndpoint')  // ✅ 清晰
   Schema.string('url')          // ❌ 模糊
   ```

2. **提供合理的默认值**
   ```typescript
   Schema.number().default(3)    // ✅ 有默认值
   Schema.number()               // ❌ 无默认值可能导致 undefined
   ```

3. **添加描述和验证**
   ```typescript
   Schema.number()
     .min(1)
     .max(10)
     .description('重试次数（1-10）')  // ✅ 清晰的限制和说明
   ```

4. **使用嵌套对象组织相关配置**
   ```typescript
   Schema.object({
     api: Schema.object({
       endpoint: Schema.string(),
       key: Schema.string()
     }),
     cache: Schema.object({
       enabled: Schema.boolean(),
       ttl: Schema.number()
     })
   })
   ```

5. **在插件挂载时读取配置**
   ```typescript
   onMounted(() => {
     const config = plugin.getConfig();
     // 使用配置初始化
   });
   ```

## 高级功能

### 自定义验证

```typescript
Schema.string().validate((value) => {
  if (!value.startsWith('http')) {
    return 'URL 必须以 http 开头';
  }
  return true;
});
```

### 联合类型

```typescript
Schema.union([
  Schema.string(),
  Schema.number()
])  // 可以是字符串或数字
```

### 字典类型

```typescript
Schema.dict(Schema.string())  // { [key: string]: string }
```

## 故障排除

1. **配置未生效** - 确保插件已正确设置 `static schema`
2. **验证失败** - 检查配置值是否符合 Schema 定义
3. **API 返回 404** - 确保插件已加载并设置了 Schema
4. **配置未更新** - 检查是否正确监听 `config.changed` 事件

## 相关文档

- [Schema API 文档](../api/schema.md)
- [插件开发指南](../plugin/development.md)
- [配置文件格式](./configuration.md)
