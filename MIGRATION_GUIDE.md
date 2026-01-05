# Zhin.js 2.0 升级指南

> 从 1.x 版本升级到 2.0 版本的完整迁移指南

## 📋 目录

- [概述](#概述)
- [重大变更](#重大变更)
- [迁移步骤](#迁移步骤)
- [API 变更对照表](#api-变更对照表)
- [插件迁移示例](#插件迁移示例)
- [常见问题](#常见问题)

---

## 概述

Zhin.js 2.0 是一次重大架构升级，主要变更包括：

- ✅ **新的插件系统**：基于 `AsyncLocalStorage` 的上下文管理
- ✅ **内置服务**：command、component、cron、permission、config、database
- ✅ **配置文件格式**：从 `.ts` 迁移到 `.yml`
- ✅ **简化的 API**：移除 `App` 类，使用 `usePlugin()` 和 `useContext()`
- ✅ **自动资源清理**：插件卸载时自动清理注册的资源
- ✅ **增强的数据库**：事务、迁移、生命周期钩子、多对多关系

---

## 重大变更

### 1. 核心架构变更

#### ❌ 移除的 API

```typescript
// 1.x 版本
import { App } from 'zhin.js';
const app = new App(config);
app.plugin(myPlugin);
app.start();
```

#### ✅ 新的 API

```typescript
// 2.0 版本
// 不再需要手动创建 App，直接编写插件
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();
// 插件逻辑...
```

### 2. 配置文件格式变更

#### ❌ 旧格式 (`zhin.config.ts`)

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js';

export default defineConfig({
  log_level: 1,
  database: {
    dialect: 'sqlite',
    filename: './data/test.db'
  },
  plugins: [
    'test-plugin',
    '@zhin.js/http'
  ]
});
```

#### ✅ 新格式 (`zhin.config.yml`)

```yaml
# zhin.config.yml
log_level: 1
database:
  dialect: sqlite
  filename: ./data/test.db
plugin_dirs:
  - node_modules
  - ./src/plugins
plugins:
  - test-plugin
  - "@zhin.js/http"
http:
  port: 8086
  username: admin
  password: secret
```

### 3. 插件编写方式变更

#### ❌ 旧方式

```typescript
// 1.x 版本
export function apply(app: App) {
  app.command('hello')
    .action((ctx) => {
      ctx.reply('Hello World!');
    });
}
```

#### ✅ 新方式

```typescript
// 2.0 版本
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();
const { addCommand } = plugin;

addCommand('hello', (ctx) => {
  ctx.reply('Hello World!');
});
```

---

## 迁移步骤

### 步骤 1: 更新依赖

```bash
# 更新到最新版本
pnpm update zhin.js @zhin.js/core

# 或者重新安装
pnpm install zhin.js@latest @zhin.js/core@latest
```

### 步骤 2: 转换配置文件

将 `zhin.config.ts` 转换为 `zhin.config.yml`：

```bash
# 删除旧配置
rm zhin.config.ts

# 创建新配置
touch zhin.config.yml
```

然后按照新格式填写配置（参考上面的示例）。

### 步骤 3: 迁移插件代码

#### 3.1 更新导入语句

```typescript
// ❌ 旧版本
import { App, Plugin, Context } from 'zhin.js';

// ✅ 新版本
import { usePlugin, useContext } from 'zhin.js';
```

#### 3.2 移除 `apply` 函数

```typescript
// ❌ 旧版本
export function apply(app: App) {
  // 插件逻辑
}

// ✅ 新版本
// 直接编写插件逻辑，无需导出 apply 函数
const plugin = usePlugin();
// 插件逻辑
```

#### 3.3 使用新的 API

```typescript
// ❌ 旧版本
app.command('test')
  .option('name', '-n <name>')
  .action((ctx, options) => {
    ctx.reply(`Hello ${options.name}`);
  });

// ✅ 新版本
const { addCommand } = usePlugin();

addCommand('test [name:string]', (ctx) => {
  ctx.reply(`Hello ${ctx.args.name}`);
}, {
  description: '测试命令',
  options: {
    name: { type: 'string', alias: 'n' }
  }
});
```

### 步骤 4: 更新服务使用方式

#### 4.1 配置服务

```typescript
// ❌ 旧版本
const config = app.config.get('myPlugin');

// ✅ 新版本
const { useContext } = usePlugin();

useContext('config', (configService) => {
  const appConfig = configService.get('zhin.config.yml');
  const myConfig = appConfig.myPlugin || {};
});
```

#### 4.2 数据库服务

```typescript
// ❌ 旧版本
app.database.define('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'text' }
});

// ✅ 新版本
const plugin = usePlugin();

// 方式 1: 使用 defineModel 扩展方法
plugin.defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'text' }
});

// 方式 2: 在 useContext 中定义
useContext('database', (db) => {
  db.define('users', {
    id: { type: 'integer', primary: true },
    name: { type: 'text' }
  });
});
```

#### 4.3 定时任务

```typescript
// ❌ 旧版本
app.cron('0 0 * * *', () => {
  console.log('Daily task');
});

// ✅ 新版本
const { addCron } = usePlugin();

addCron('0 0 * * *', () => {
  console.log('Daily task');
}, { name: 'daily-task' });
```

### 步骤 5: 更新适配器插件

```typescript
// ❌ 旧版本
import { Adapter } from 'zhin.js';

class MyAdapter extends Adapter {
  async start() {
    // 启动逻辑
  }
}

export function apply(app: App) {
  app.adapter(MyAdapter);
}

// ✅ 新版本
import { Adapter, usePlugin } from 'zhin.js';

class MyAdapter extends Adapter {
  constructor(plugin: Plugin, config: MyAdapterConfig) {
    super(plugin, 'my-adapter');
    // 初始化逻辑
  }

  async start() {
    // 启动逻辑
  }
}

const plugin = usePlugin();
const config = plugin.config as MyAdapterConfig;
const adapter = new MyAdapter(plugin, config);
```

---

## API 变更对照表

### 核心 API

| 1.x 版本 | 2.0 版本 | 说明 |
|---------|---------|------|
| `new App(config)` | 无需手动创建 | 自动初始化 |
| `app.plugin(fn)` | 直接编写插件代码 | 插件即文件 |
| `app.command()` | `addCommand()` | 从 `usePlugin()` 获取 |
| `app.middleware()` | `addMiddleware()` | 从 `usePlugin()` 获取 |
| `app.cron()` | `addCron()` | 从 `usePlugin()` 获取 |
| `app.on()` | `plugin.on()` | 事件监听 |
| `app.emit()` | `plugin.emit()` | 事件触发 |
| `app.config` | `useContext('config')` | 配置服务 |
| `app.database` | `useContext('database')` | 数据库服务 |

### 插件 API

| 1.x 版本 | 2.0 版本 | 说明 |
|---------|---------|------|
| `plugin.name` | `plugin.name` | 插件名称 |
| `plugin.config` | `plugin.config` | 插件配置 |
| `plugin.logger` | `plugin.logger` | 日志记录器 |
| `plugin.dispose()` | `plugin.stop()` | 停止插件 |
| 无 | `plugin.onDispose()` | 注册清理函数 |
| 无 | `plugin.features` | 插件功能统计 |

### 上下文 API

| 1.x 版本 | 2.0 版本 | 说明 |
|---------|---------|------|
| `ctx.app` | `plugin.root` | 根插件 |
| `ctx.command` | `ctx.command` | 当前命令 |
| `ctx.bot` | `ctx.bot` | 当前机器人 |
| `ctx.reply()` | `ctx.reply()` | 回复消息 |
| `ctx.prompt()` | `ctx.prompt()` | 等待用户输入 |

### 命令 API

| 1.x 版本 | 2.0 版本 | 说明 |
|---------|---------|------|
| `.option(name, desc)` | `options: {}` 配置 | 选项定义 |
| `.alias(name)` | `alias: []` 配置 | 命令别名 |
| `.usage(text)` | `usage: ''` 配置 | 使用说明 |
| `.example(text)` | `examples: []` 配置 | 示例列表 |
| `.action(fn)` | 直接传入回调函数 | 命令处理器 |

---

## 插件迁移示例

### 示例 1: 简单命令插件

#### ❌ 旧版本

```typescript
// plugins/hello/index.ts
import { App } from 'zhin.js';

export function apply(app: App) {
  app.command('hello <name>')
    .option('greeting', '-g <text>', '问候语', '你好')
    .action((ctx, options) => {
      const { name } = ctx.args;
      ctx.reply(`${options.greeting}, ${name}!`);
    });
}
```

#### ✅ 新版本

```typescript
// plugins/hello/index.ts
import { usePlugin } from 'zhin.js';

const { addCommand } = usePlugin();

addCommand('hello <name:string>', (ctx) => {
  const greeting = ctx.options.greeting || '你好';
  ctx.reply(`${greeting}, ${ctx.args.name}!`);
}, {
  description: '问候命令',
  options: {
    greeting: {
      type: 'string',
      alias: 'g',
      description: '问候语',
      default: '你好'
    }
  }
});
```

### 示例 2: 数据库插件

#### ❌ 旧版本

```typescript
// plugins/user-manager/index.ts
import { App } from 'zhin.js';

export function apply(app: App) {
  // 定义模型
  app.database.define('users', {
    id: { type: 'integer', primary: true },
    name: { type: 'text', nullable: false },
    email: { type: 'text', unique: true }
  });

  // 添加命令
  app.command('user.add <name> <email>')
    .action(async (ctx) => {
      const { name, email } = ctx.args;
      const user = await app.database.models.get('users').create({
        name,
        email
      });
      ctx.reply(`用户创建成功: ${user.id}`);
    });
}
```

#### ✅ 新版本

```typescript
// plugins/user-manager/index.ts
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();
const { addCommand, useContext } = plugin;

// 定义模型
plugin.defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'text', nullable: false },
  email: { type: 'text', unique: true }
});

// 等待数据库就绪后添加命令
useContext('database', (db) => {
  const UserModel = db.models.get('users');

  addCommand('user.add <name:string> <email:string>', async (ctx) => {
    const { name, email } = ctx.args;
    const user = await UserModel.create({ name, email });
    ctx.reply(`用户创建成功: ${user.id}`);
  }, {
    description: '添加用户'
  });
});
```

### 示例 3: 适配器插件

#### ❌ 旧版本

```typescript
// plugins/my-adapter/index.ts
import { App, Adapter, Bot } from 'zhin.js';

class MyAdapter extends Adapter {
  constructor(app: App, config: any) {
    super(app, 'my-adapter');
    this.config = config;
  }

  async start() {
    const bot = new Bot(this, 'bot-id');
    this.bots.set('bot-id', bot);
    // 连接逻辑
  }

  async stop() {
    // 断开连接
  }
}

export function apply(app: App) {
  const config = app.config.get('myAdapter');
  const adapter = new MyAdapter(app, config);
  app.adapters.set('my-adapter', adapter);
}
```

#### ✅ 新版本

```typescript
// plugins/my-adapter/index.ts
import { Adapter, Bot, usePlugin } from 'zhin.js';

interface MyAdapterConfig {
  token: string;
  endpoint: string;
}

class MyAdapter extends Adapter<MyAdapterConfig> {
  constructor(plugin: Plugin, config: MyAdapterConfig) {
    super(plugin, 'my-adapter');
    this.config = config;
  }

  async start() {
    const bot = new Bot(this, 'bot-id');
    this.bots.set('bot-id', bot);
    // 连接逻辑
    this.logger.info('适配器已启动');
  }

  async stop() {
    // 断开连接
    this.logger.info('适配器已停止');
  }
}

const plugin = usePlugin();
const config = plugin.config as MyAdapterConfig;

// 创建并注册适配器
const adapter = new MyAdapter(plugin, config);

// 适配器会自动在插件停止时清理
```

### 示例 4: 定时任务插件

#### ❌ 旧版本

```typescript
// plugins/scheduler/index.ts
import { App } from 'zhin.js';

export function apply(app: App) {
  // 每天凌晨执行
  app.cron('0 0 * * *', async () => {
    console.log('执行每日任务');
    // 清理数据
    await app.database.models.get('logs').delete({
      timestamp: { $lt: Date.now() - 7 * 24 * 60 * 60 * 1000 }
    });
  });

  // 每小时执行
  app.cron('0 * * * *', () => {
    console.log('执行每小时任务');
  });
}
```

#### ✅ 新版本

```typescript
// plugins/scheduler/index.ts
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();
const { addCron, useContext, logger } = plugin;

// 每天凌晨执行
addCron('0 0 * * *', async () => {
  logger.info('执行每日任务');
  
  // 等待数据库服务
  const db = plugin.root.inject('database');
  if (db) {
    await db.models.get('logs')?.delete({
      timestamp: { $lt: Date.now() - 7 * 24 * 60 * 60 * 1000 }
    });
  }
}, {
  name: 'daily-cleanup',
  description: '每日清理任务'
});

// 每小时执行
addCron('0 * * * *', () => {
  logger.info('执行每小时任务');
}, {
  name: 'hourly-task',
  description: '每小时任务'
});
```

---

## 常见问题

### Q1: 如何访问全局 App 实例？

**A:** 2.0 版本不再有全局 `App` 实例，使用 `plugin.root` 访问根插件：

```typescript
const plugin = usePlugin();
const root = plugin.root;

// 访问其他服务
const db = root.inject('database');
const config = root.inject('config');
```

### Q2: 如何在插件间共享数据？

**A:** 使用 `provide()` 和 `inject()` 或 `useContext()`：

```typescript
// 插件 A：提供服务
const { provide } = usePlugin();

provide({
  name: 'myService',
  description: '我的服务',
  value: {
    getData() {
      return { foo: 'bar' };
    }
  }
});

// 插件 B：使用服务
const { useContext } = usePlugin();

useContext('myService', (service) => {
  const data = service.getData();
  console.log(data); // { foo: 'bar' }
});
```

### Q3: 如何处理插件配置？

**A:** 插件配置直接通过 `plugin.config` 访问：

```yaml
# zhin.config.yml
plugins:
  - my-plugin

my-plugin:
  apiKey: "your-api-key"
  timeout: 5000
```

```typescript
// plugins/my-plugin/index.ts
const plugin = usePlugin();
const config = plugin.config as {
  apiKey: string;
  timeout: number;
};

console.log(config.apiKey); // "your-api-key"
```

### Q4: 如何监听事件？

**A:** 使用 `plugin.on()` 或适配器的事件：

```typescript
const plugin = usePlugin();

// 监听消息事件
plugin.on('message', (message) => {
  console.log('收到消息:', message.content);
});

// 监听适配器事件
plugin.on('adapter.start', (adapter) => {
  console.log('适配器启动:', adapter.name);
});
```

### Q5: 如何处理插件依赖？

**A:** 使用 `useContext()` 等待依赖服务就绪：

```typescript
const { useContext } = usePlugin();

// 等待数据库服务就绪
useContext('database', (db) => {
  // 数据库已就绪，可以安全使用
  db.define('myModel', { /* ... */ });
});

// 等待 HTTP 服务就绪
useContext('router', (router) => {
  // 路由已就绪，可以注册路由
  router.get('/api/test', (ctx) => {
    ctx.body = { success: true };
  });
});
```

### Q6: 如何进行资源清理？

**A:** 使用 `plugin.onDispose()` 注册清理函数：

```typescript
const plugin = usePlugin();

// 创建定时器
const timer = setInterval(() => {
  console.log('tick');
}, 1000);

// 注册清理函数
plugin.onDispose(() => {
  clearInterval(timer);
  console.log('定时器已清理');
});
```

### Q7: 旧的 HMR 功能去哪了？

**A:** 2.0 版本使用 Node.js 原生的模块热重载机制，不再需要单独的 HMR 包。开发模式下，修改插件文件会自动重载。

### Q8: 如何迁移权限系统？

**A:** 权限系统现在是内置服务：

```typescript
// ❌ 旧版本
app.permissions.define('admin', {
  authority: 5
});

// ✅ 新版本
const { useContext } = usePlugin();

useContext('permission', (permissionService) => {
  permissionService.define('admin', {
    authority: 5
  });
});
```

### Q9: 数据库迁移如何使用？

**A:** 2.0 版本新增了完整的迁移系统：

```typescript
const { useContext } = usePlugin();

useContext('database', (db) => {
  const runner = db.migrationRunner;

  // 定义迁移
  runner.defineMigration('001_create_users', {
    up: async (ctx) => {
      await ctx.createTable('users', {
        id: { type: 'integer', primary: true },
        name: { type: 'text', nullable: false }
      });
    }
    // down 会自动生成
  });

  // 执行迁移
  await runner.migrate();
});
```

### Q10: 如何调试插件？

**A:** 使用内置的日志系统：

```typescript
const { logger } = usePlugin();

logger.debug('调试信息');
logger.info('普通信息');
logger.warn('警告信息');
logger.error('错误信息');

// 设置日志级别（在 zhin.config.yml 中）
// log_level: 0 (debug) | 1 (info) | 2 (warn) | 3 (error)
```

---

## 迁移检查清单

完成以下检查确保迁移成功：

- [ ] 更新 `package.json` 中的依赖版本
- [ ] 将 `zhin.config.ts` 转换为 `zhin.config.yml`
- [ ] 移除所有 `export function apply(app: App)` 声明
- [ ] 将 `app.command()` 改为 `addCommand()`
- [ ] 将 `app.middleware()` 改为 `addMiddleware()`
- [ ] 将 `app.cron()` 改为 `addCron()`
- [ ] 将 `app.database` 改为 `useContext('database')`
- [ ] 将 `app.config` 改为 `useContext('config')` 或 `plugin.config`
- [ ] 更新适配器插件构造函数签名
- [ ] 添加必要的 `plugin.onDispose()` 清理逻辑
- [ ] 测试所有命令和功能
- [ ] 检查日志输出是否正常
- [ ] 验证数据库操作是否正常
- [ ] 确认定时任务是否按预期执行

---

## 获取帮助

如果在迁移过程中遇到问题：

1. 查看 [官方文档](https://zhin.dev)
2. 查看 [示例项目](https://github.com/zhinjs/zhin/tree/main/examples)
3. 提交 [Issue](https://github.com/zhinjs/zhin/issues)
4. 加入 [Discord 社区](https://discord.gg/zhinjs)

---

## 版本兼容性

| 功能 | 1.x | 2.0 | 说明 |
|-----|-----|-----|------|
| App 类 | ✅ | ❌ | 已移除 |
| Plugin 系统 | ✅ | ✅ | 完全重构 |
| 配置文件 | .ts | .yml | 格式变更 |
| 命令系统 | ✅ | ✅ | API 变更 |
| 数据库 | ✅ | ✅ | 功能增强 |
| 适配器 | ✅ | ✅ | API 变更 |
| HMR | ✅ | ✅ | 原生支持 |
| 权限系统 | ✅ | ✅ | 改为内置服务 |

---

## 总结

Zhin.js 2.0 带来了更简洁的 API 和更强大的功能。虽然迁移需要一些工作，但新架构将为你的项目带来：

- 🚀 **更好的性能**：优化的插件加载和资源管理
- 🧹 **自动清理**：无需手动管理资源生命周期
- 📦 **模块化**：更清晰的服务边界和依赖管理
- 🔧 **更好的开发体验**：类型安全、自动补全、热重载
- 📚 **完善的文档**：详细的 API 文档和示例

祝你迁移顺利！🎉

