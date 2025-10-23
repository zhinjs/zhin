# 🎨 Schema 配置系统快速上手

Zhin.js 的 Schema 配置系统让你能够以类型安全的方式定义和管理插件配置，支持实时验证、Web 界面编辑和热重载。

## ⚡ 5分钟快速体验

### 1. 基础 Schema 定义

```typescript
import { Schema, defineSchema, usePlugin } from 'zhin.js';

// 🎯 定义插件配置结构
defineSchema(Schema.object({
  // 字符串配置
  name: Schema.string()
    .default('我的插件')
    .description('插件名称'),
  
  // 数字配置（带范围限制）
  maxUsers: Schema.number()
    .default(100)
    .min(1)
    .max(1000)
    .description('最大用户数量'),
  
  // 布尔配置
  enabled: Schema.boolean()
    .default(true)
    .description('是否启用插件')
}));

// 🔧 使用配置
const plugin = usePlugin();
console.log('插件配置:', plugin.config);
```

### 2. 在配置文件中提供值

```typescript
// zhin.config.ts
export default defineConfig({
  // ... 其他配置
  
  // 插件配置
  'my-plugin': {
    name: '超级插件',
    maxUsers: 500,
    enabled: true
  }
});
```

### 3. 启动并在 Web 界面编辑

```bash
pnpm dev
```

访问 `http://localhost:8086`，在配置管理页面即可看到可视化的配置编辑界面！

## 🎯 Schema 类型详解

### 基础类型

```typescript
// 字符串
Schema.string()
  .default('默认值')
  .min(1)              // 最小长度
  .max(100)            // 最大长度
  .description('描述')

// 数字
Schema.number()
  .default(0)
  .min(0)              // 最小值
  .max(100)            // 最大值
  .step(1)             // 步长

// 布尔值
Schema.boolean()
  .default(false)

// 日期
Schema.date()
  .default(new Date())

// 正则表达式
Schema.regexp()
  .default(/pattern/)
```

### 容器类型

```typescript
// 数组
Schema.list(Schema.string())
  .default(['item1', 'item2'])
  .description('字符串数组')

// 对象
Schema.object({
  nested: Schema.string().default('value'),
  count: Schema.number().default(0)
})

// 字典（键值对）
Schema.dict(Schema.number())
  .description('字符串到数字的映射')
```

### 高级类型

```typescript
// 联合类型（新特性！）
Schema.union([
  Schema.string(),
  Schema.number(),
  Schema.boolean()
]).description('可以是字符串、数字或布尔值')

// 元组
Schema.tuple([
  Schema.string(),
  Schema.number()
]).description('固定长度的有序数组')

// 常量
Schema.const('CONSTANT_VALUE')
  .description('固定常量值')

// 枚举选择
Schema.union([
  Schema.const('debug'),
  Schema.const('info'),
  Schema.const('warn'),
  Schema.const('error')
]).default('info').description('日志级别')
```

## 🎨 实战示例

### API 客户端插件配置

```typescript
defineSchema(Schema.object({
  // API 基础配置
  api: Schema.object({
    endpoint: Schema.string()
      .default('https://api.example.com')
      .description('API 端点地址'),
    
    key: Schema.string()
      .required()
      .description('API 密钥'),
    
    timeout: Schema.number()
      .default(5000)
      .min(1000)
      .max(30000)
      .description('请求超时时间（毫秒）')
  }).description('API 配置'),
  
  // 功能开关
  features: Schema.object({
    cache: Schema.boolean()
      .default(true)
      .description('启用缓存'),
    
    retry: Schema.boolean()
      .default(true)
      .description('启用重试'),
    
    rateLimit: Schema.boolean()
      .default(false)
      .description('启用速率限制')
  }).description('功能开关'),
  
  // 高级设置
  advanced: Schema.object({
    maxRetries: Schema.number()
      .default(3)
      .min(0)
      .max(10)
      .description('最大重试次数'),
    
    cacheExpiry: Schema.number()
      .default(300)
      .min(60)
      .description('缓存过期时间（秒）'),
    
    userAgent: Schema.string()
      .default('Zhin.js Bot/1.0')
      .description('用户代理字符串')
  }).description('高级设置')
}));
```

### 游戏机器人配置

```typescript
defineSchema(Schema.object({
  // 游戏设置
  game: Schema.object({
    name: Schema.string()
      .default('猜数字游戏')
      .description('游戏名称'),
    
    difficulty: Schema.union([
      Schema.const('easy'),
      Schema.const('medium'),
      Schema.const('hard')
    ]).default('medium').description('游戏难度'),
    
    maxPlayers: Schema.number()
      .default(10)
      .min(1)
      .max(100)
      .description('最大玩家数量')
  }).description('游戏设置'),
  
  // 奖励系统
  rewards: Schema.object({
    enabled: Schema.boolean()
      .default(true)
      .description('启用奖励系统'),
    
    points: Schema.object({
      win: Schema.number().default(100),
      lose: Schema.number().default(10),
      draw: Schema.number().default(50)
    }).description('积分奖励'),
    
    items: Schema.list(Schema.object({
      name: Schema.string().required(),
      cost: Schema.number().min(1),
      description: Schema.string()
    })).default([
      { name: '金币', cost: 10, description: '游戏货币' }
    ]).description('可购买物品')
  }).description('奖励系统'),
  
  // 消息模板
  messages: Schema.object({
    welcome: Schema.string()
      .default('欢迎参加{游戏名称}！')
      .description('欢迎消息模板'),
    
    win: Schema.string()
      .default('🎉 恭喜 {玩家} 获胜！')
      .description('获胜消息模板'),
    
    lose: Schema.string()
      .default('😔 {玩家} 失败了，再接再厉！')
      .description('失败消息模板')
  }).description('消息模板')
}));
```

## 🌐 Web 界面配置管理

### 访问配置界面

1. 启动机器人：`pnpm dev`
2. 打开浏览器访问：`http://localhost:8086`
3. 点击侧边栏的「配置管理」

### 界面功能

- 📝 **表单编辑** - 基于 Schema 自动生成的表单界面
- ✅ **实时验证** - 输入时即时验证，错误提示友好
- 💾 **一键保存** - 保存后立即生效，无需重启
- 🔄 **配置重置** - 一键恢复默认配置
- 📋 **配置导入/导出** - JSON 格式配置文件管理
- 📖 **内置文档** - 每个配置项都有详细说明

### 配置文件格式

配置会自动保存到 `zhin.config.ts`：

```typescript
export default defineConfig({
  // 其他配置...
  
  'my-plugin': {
    api: {
      endpoint: 'https://api.example.com',
      key: 'your-api-key-here',
      timeout: 10000
    },
    features: {
      cache: true,
      retry: true,
      rateLimit: false
    },
    advanced: {
      maxRetries: 5,
      cacheExpiry: 600,
      userAgent: 'Custom Bot/2.0'
    }
  }
});
```

## 🔄 配置热重载

配置修改后会立即生效，无需重启机器人：

```typescript
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();

// 监听配置变化
plugin.on('config.changed', (newConfig) => {
  console.log('配置已更新:', newConfig);
  
  // 重新初始化服务
  reinitializeService(newConfig);
});

// 获取当前配置
const currentConfig = plugin.config;
```

## 🎯 最佳实践

### 1. 使用描述性的键名和描述

```typescript
// ✅ 好的实践
Schema.object({
  apiEndpoint: Schema.string()
    .description('API 服务器地址，支持 HTTP 和 HTTPS'),
  
  requestTimeout: Schema.number()
    .description('HTTP 请求超时时间，单位毫秒，范围 1000-30000')
    .min(1000)
    .max(30000)
})

// ❌ 避免这样
Schema.object({
  url: Schema.string(),  // 没有描述，不清楚用途
  time: Schema.number()  // 键名模糊，不知道单位
})
```

### 2. 提供合理的默认值

```typescript
// ✅ 提供默认值
Schema.object({
  maxRetries: Schema.number()
    .default(3)
    .min(1)
    .max(10),
  
  cacheEnabled: Schema.boolean()
    .default(true)
})

// ❌ 缺少默认值可能导致 undefined
Schema.object({
  maxRetries: Schema.number(),  // 可能是 undefined
  cacheEnabled: Schema.boolean()
})
```

### 3. 使用嵌套对象组织相关配置

```typescript
// ✅ 良好的组织结构
Schema.object({
  database: Schema.object({
    host: Schema.string().default('localhost'),
    port: Schema.number().default(5432),
    name: Schema.string().required()
  }),
  
  cache: Schema.object({
    enabled: Schema.boolean().default(true),
    ttl: Schema.number().default(300)
  })
})

// ❌ 扁平化结构，难以管理
Schema.object({
  dbHost: Schema.string(),
  dbPort: Schema.number(),
  dbName: Schema.string(),
  cacheEnabled: Schema.boolean(),
  cacheTtl: Schema.number()
})
```

### 4. 使用联合类型替代字符串枚举

```typescript
// ✅ 使用联合类型，类型安全
Schema.union([
  Schema.const('debug'),
  Schema.const('info'),
  Schema.const('warn'),
  Schema.const('error')
]).default('info')

// ❌ 字符串类型，容易出错
Schema.string()
  .default('info')
  .description('可选值: debug, info, warn, error')
```

## 📚 进阶学习

- [Schema 系统完整指南](./schema-system.md) - 深入了解所有特性
- [插件开发指南](../plugin/development.md) - 学习插件开发
- [配置文件格式](./configuration.md) - 配置文件详解
- [插件系统概览](../plugin/index.md) - 插件系统详解

---

🎉 恭喜！你已经掌握了 Zhin.js Schema 配置系统的基础用法。现在可以开始创建你自己的类型安全配置了！