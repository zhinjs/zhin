# 快速升级指南

> 5 分钟快速升级到 Zhin.js 2.0

## 🚀 快速开始

### 1. 更新依赖

```bash
pnpm update zhin.js @zhin.js/core
```

### 2. 转换配置文件

**删除** `zhin.config.ts`，**创建** `zhin.config.yml`：

```yaml
log_level: 1
database:
  dialect: sqlite
  filename: ./data/bot.db
plugin_dirs:
  - node_modules
  - ./src/plugins
plugins:
  - your-plugin
```

### 3. 更新插件代码

#### 之前：

```typescript
import { App } from 'zhin.js';

export function apply(app: App) {
  app.command('hello')
    .action((ctx) => {
      ctx.reply('Hello!');
    });
}
```

#### 之后：

```typescript
import { usePlugin } from 'zhin.js';

const { addCommand } = usePlugin();

addCommand('hello', (ctx) => {
  ctx.reply('Hello!');
});
```

## 📝 核心变更

### API 对照表

| 旧 API | 新 API |
|--------|--------|
| `new App(config)` | 自动初始化 |
| `app.command()` | `addCommand()` |
| `app.middleware()` | `addMiddleware()` |
| `app.cron()` | `addCron()` |
| `app.database` | `useContext('database')` |
| `app.config` | `plugin.config` |

### 完整示例

```typescript
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();
const { addCommand, addCron, useContext, logger } = plugin;

// 1. 定义数据模型
plugin.defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'text', nullable: false }
});

// 2. 添加命令
addCommand('user.add <name:string>', async (ctx) => {
  const db = plugin.root.inject('database');
  const user = await db.models.get('users').create({
    name: ctx.args.name
  });
  ctx.reply(`用户创建成功: ${user.id}`);
}, {
  description: '添加用户'
});

// 3. 添加定时任务
addCron('0 0 * * *', () => {
  logger.info('执行每日任务');
}, {
  name: 'daily-task'
});

// 4. 使用服务
useContext('database', (db) => {
  logger.info('数据库已就绪');
});
```

## ✅ 完成！

详细迁移指南请查看 [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)

