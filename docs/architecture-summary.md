# Zhin.js 架构总结

## 🏗️ 核心架构

### 1. Plugin 类（核心）

**继承关系**：
```typescript
Plugin extends EventEmitter
```

**关键特性**：
- ✅ 使用 `AsyncLocalStorage` 管理上下文
- ✅ React Hooks 风格 API (`usePlugin`, `useContext`)
- ✅ 依赖注入系统 (`provide`, `inject`)
- ✅ 生命周期管理 (`start`, `stop`, `onDispose`)
- ✅ 事件系统 (`dispatch`, `broadcast`)
- ✅ 自动资源清理

### 2. 上下文系统（Context）

**定义**：
```typescript
interface Context<T extends keyof Plugin.Contexts> {
  name: T;
  description?: string;
  value?: Plugin.Contexts[T];
  mounted?: (plugin: Plugin) => MaybePromise<Plugin.Contexts[T]>;
  dispose?: (value: Plugin.Contexts[T]) => MaybePromise<void>;
  extensions?: Record<string, Function>;
}
```

**内置上下文**：
- `config`: ConfigService
- `database`: Database
- `command`: CommandService
- `component`: ComponentService
- `cron`: CronService
- `permission`: PermissionService
- `process`: ProcessAdapter
- `router`: Router (HTTP)
- `server`: Server (HTTP)
- `koa`: Koa (HTTP)
- `web`: WebServer (Console)

## 📝 插件开发语法

### 基础用法

```typescript
import { usePlugin, MessageCommand } from 'zhin.js';

// 1. 获取插件实例
const { addCommand, addComponent, useContext, logger } = usePlugin();

// 2. 添加命令
addCommand(
  new MessageCommand('hello <name:text>')
    .desc('打招呼')
    .action((message, result) => {
      return `你好，${result.params.name}！`;
    })
);

// 3. 使用上下文依赖
useContext('database', async (db) => {
  const users = await db.select('user').execute();
  logger.info(`用户数量: ${users.length}`);
});

// 4. 注册清理函数
const { onDispose } = usePlugin();
onDispose(() => {
  logger.info('插件正在卸载');
});
```

### 提供服务

```typescript
import { usePlugin } from 'zhin.js';

const { provide } = usePlugin();

// 提供一个服务
provide({
  name: 'myService',
  description: '我的服务',
  mounted: async (plugin) => {
    const service = new MyService();
    await service.init();
    return service;
  },
  dispose: async (service) => {
    await service.cleanup();
  },
  extensions: {
    // 扩展方法会自动添加到 Plugin.prototype
    myMethod() {
      return this.inject('myService');
    }
  }
});

// 类型声明
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyService;
    }
    interface Extensions {
      myMethod(): MyService;
    }
  }
}
```

### 使用多个上下文

```typescript
// 等待多个上下文就绪
useContext('database', 'config', async (db, config) => {
  const dbConfig = config.get('database');
  logger.info(`数据库配置: ${JSON.stringify(dbConfig)}`);
  
  // 返回清理函数
  return async (context) => {
    logger.info('上下文被移除:', context);
  };
});
```

### 命令系统

```typescript
import { MessageCommand } from 'zhin.js';

addCommand(
  new MessageCommand('echo <content:text>')
    .desc('回显消息')
    .usage('echo <内容>')
    .examples('echo 你好世界')
    .action((message, result) => {
      return result.params.content;
    })
);

// 带选项的命令
addCommand(
  new MessageCommand('search <keyword:text>')
    .option('-l, --limit <num:number>', '限制结果数量', { default: 10 })
    .option('-s, --sort <type:string>', '排序方式', { default: 'relevance' })
    .action((message, result) => {
      const { keyword } = result.params;
      const { limit, sort } = result.options;
      return `搜索 "${keyword}"，限制 ${limit} 条，排序: ${sort}`;
    })
);
```

### 组件系统

```typescript
import { defineComponent } from 'zhin.js';

const MyComponent = defineComponent({
  name: 'my-comp',
  props: {
    title: String,
    count: { type: Number, default: 0 }
  },
  data(this: { title: string, count: number }) {
    return {
      message: `${this.title}: ${this.count}`
    };
  },
  render(props, context) {
    return `<text>${context.message}</text>`;
  }
});

addComponent(MyComponent);

// 使用组件
// <my-comp title="计数器" :count="5"/>
```

### 定时任务

```typescript
import { Cron } from 'zhin.js';

const { addCron } = usePlugin();

// 每天凌晨执行
addCron(
  new Cron('0 0 * * *', async () => {
    logger.info('执行每日任务');
    // 任务逻辑
  })
);
```

### 中间件

```typescript
const { addMiddleware } = usePlugin();

// 添加日志中间件
addMiddleware(async (message, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info(`处理消息耗时: ${duration}ms`);
});

// 添加权限中间件
addMiddleware(async (message, next) => {
  if (isAdmin(message.sender.id)) {
    await next();
  } else {
    await message.reply('权限不足');
  }
});
```

## 🔧 配置系统

### 配置文件（zhin.config.yml）

```yaml
# 日志级别
log_level: 1  # 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR

# 数据库配置
database:
  dialect: sqlite
  filename: ./data/bot.db

# 插件目录
plugin_dirs:
  - node_modules/@zhin.js
  - ./plugins

# 启用的插件
plugins:
  - "@zhin.js/http"
  - "@zhin.js/console"
  - "@zhin.js/adapter-sandbox"

# 启用的服务
services:
  - process
  - config
  - command
  - component
  - permission
  - cron

# HTTP 配置
http:
  port: 8088
  username: admin
  password: admin123
  base: /api

# Console 配置
console:
  enabled: true
  lazyLoad: true  # 延迟加载 Vite
```

### 环境变量替换

```yaml
database:
  host: ${DB_HOST:-localhost}  # 使用环境变量，默认 localhost
  port: ${DB_PORT:-5432}
  password: ${DB_PASSWORD}     # 必需的环境变量
```

### 读取配置

```typescript
useContext('config', (config) => {
  // 读取配置
  const port = config.get('http.port');  // 点号路径
  const dbConfig = config.get('database');
  
  // 修改配置（自动保存）
  config.set('http.port', 3000);
});
```

## 🎯 生命周期

### 插件生命周期

```
1. 创建 (usePlugin)
   ↓
2. 注册服务 (provide)
   ↓
3. 启动 (start)
   - 执行 mounted 回调
   - 注册 extensions
   - 触发 'mounted' 事件
   ↓
4. 运行中
   - 处理消息
   - 执行命令
   - 定时任务
   ↓
5. 停止 (stop)
   - 触发 'dispose' 事件
   - 执行清理函数
   - 调用 dispose 回调
   - 清理资源
```

### 钩子函数

```typescript
const { onMounted, onDispose } = usePlugin();

// 插件挂载时
onMounted(() => {
  logger.info('插件已挂载');
});

// 插件销毁时
onDispose(() => {
  logger.info('插件正在销毁');
  // 清理资源
});
```

## 🔌 适配器系统

### 创建适配器

```typescript
import { Adapter, Bot, usePlugin } from 'zhin.js';

class MyBot implements Bot {
  constructor(public config: BotConfig) {}
  
  async connect() {
    // 连接逻辑
  }
  
  async disconnect() {
    // 断开连接
  }
  
  async $sendMessage(options: SendOptions) {
    // 发送消息
  }
  
  async $recallMessage(messageId: string) {
    // 撤回消息
  }
}

// 注册适配器
const { provide } = usePlugin();

provide({
  name: 'myAdapter',
  description: '我的适配器',
  mounted: async (plugin) => {
    const adapter = new Adapter(plugin, 'myAdapter', config);
    adapter.createBot = (config) => new MyBot(config);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  }
});
```

## 📦 数据库系统

### 定义模型

```typescript
declare module 'zhin.js' {
  interface Models {
    user: {
      id: number;
      name: string;
      email: string;
      created_at: Date;
    };
  }
}

// 使用数据库
useContext('database', async (db) => {
  // 查询
  const users = await db.select('user').execute();
  
  // 插入
  await db.insert('user', {
    name: 'Alice',
    email: 'alice@example.com'
  });
  
  // 更新
  await db.update('user')
    .where({ id: 1 })
    .set({ name: 'Bob' })
    .execute();
  
  // 删除
  await db.delete('user')
    .where({ id: 1 })
    .execute();
});
```

## 🚀 最佳实践

### 1. 资源清理

```typescript
const { onDispose } = usePlugin();

// 定时器
const timer = setInterval(() => {
  // ...
}, 1000);
onDispose(() => clearInterval(timer));

// 文件监听
const watcher = fs.watch('./config.yml', () => {});
onDispose(() => watcher.close());

// 数据库连接
useContext('database', async (db) => {
  return async () => {
    // 上下文被移除时自动调用
    await db.cleanup();
  };
});
```

### 2. 类型安全

```typescript
// 扩展类型
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyService;
    }
    interface Extensions {
      myMethod(): void;
    }
  }
  interface Models {
    myTable: {
      id: number;
      name: string;
    };
  }
}
```

### 3. 错误处理

```typescript
addCommand(
  new MessageCommand('risky')
    .action(async (message) => {
      try {
        // 可能出错的操作
        await riskyOperation();
        return '操作成功';
      } catch (error) {
        logger.error('操作失败:', error);
        return '操作失败，请稍后重试';
      }
    })
);
```

### 4. 异步操作

```typescript
// 使用 useContext 等待依赖就绪
useContext('database', 'config', async (db, config) => {
  // 依赖都就绪后才执行
  const data = await db.select('user').execute();
  logger.info(`加载了 ${data.length} 个用户`);
});
```

## 📚 常用 API 速查

### Plugin 实例方法

| 方法 | 说明 |
|------|------|
| `addCommand(cmd)` | 添加命令 |
| `addComponent(comp)` | 添加组件 |
| `addCron(cron)` | 添加定时任务 |
| `addMiddleware(fn)` | 添加中间件 |
| `provide(context)` | 提供服务 |
| `inject(name)` | 注入服务 |
| `useContext(...names, fn)` | 使用上下文 |
| `onDispose(fn)` | 注册清理函数 |
| `import(path)` | 动态导入插件 |

### 工具函数

| 函数 | 说明 |
|------|------|
| `usePlugin()` | 获取插件实例 |
| `getPlugin()` | 获取当前插件（不创建新实例） |
| `defineComponent(options)` | 定义组件 |

### 类

| 类 | 说明 |
|------|------|
| `MessageCommand` | 消息命令 |
| `Cron` | 定时任务 |
| `Adapter` | 适配器基类 |
| `ConfigService` | 配置服务 |
| `CommandService` | 命令服务 |
| `ComponentService` | 组件服务 |
| `CronService` | 定时任务服务 |

## 🎓 重构要点

### 已移除

- ❌ `Dependency` 类
- ❌ `HMR` 系统
- ❌ `App` 类

### 新增

- ✅ `AsyncLocalStorage` 上下文
- ✅ `usePlugin()` Hooks API
- ✅ 自动资源清理
- ✅ 统一的生命周期

### 迁移指南

**旧代码**：
```typescript
class MyPlugin extends Plugin {
  constructor(parent) {
    super(parent);
  }
}
```

**新代码**：
```typescript
const plugin = usePlugin();
// 不需要继承，直接使用
```

**旧代码**：
```typescript
this.register('myService', async () => {
  return new MyService();
});
```

**新代码**：
```typescript
provide({
  name: 'myService',
  mounted: async () => new MyService(),
  dispose: async (service) => service.cleanup()
});
```

