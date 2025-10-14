# 🚀 高级用法示例

展示 Zhin.js 框架的高级特性和复杂用法。

## 🎯 高级插件开发

### 插件间通信
```typescript
// src/plugins/weather-plugin.ts
import { usePlugin, useLogger, register, useContext } from 'zhin.js';

const plugin = usePlugin();
const logger = useLogger();

// 注册天气服务
register({
  name: 'weather',
  description: '天气查询服务',
  async mounted() {
    logger.info('天气服务已启动');
    return {
      async getWeather(city: string) {
        // 模拟天气API调用
        return {
          city,
          temperature: Math.floor(Math.random() * 30) + 5,
          description: '晴天'
        };
      }
    };
  }
});

// 使用其他插件的服务
useContext('database', async (db) => {
  logger.info('数据库服务已就绪，可以存储天气历史');
  
  // 注册天气查询命令
  addCommand(new MessageCommand('weather <city:text>')
    .action(async (message, result) => {
      const weather = await plugin.getContext('weather').getWeather(result.args.city);
      await db.query('INSERT INTO weather_history (city, temperature, timestamp) VALUES (?, ?, ?)', 
        [weather.city, weather.temperature, Date.now()]);
      
      return `🌤️ ${weather.city} 天气：${weather.temperature}°C，${weather.description}`;
    })
  );
});
```

### 复杂命令系统
```typescript
// src/plugins/admin-plugin.ts
import { addCommand, MessageCommand, useLogger, useContext } from 'zhin.js';

const logger = useLogger();

// 权限检查中间件
const requireAdmin = (message: Message) => {
  const adminUsers = ['123456789', '987654321'];
  if (!adminUsers.includes(message.$sender.id)) {
    throw new Error('权限不足');
  }
};

// 用户管理命令
addCommand(new MessageCommand('user list [page:number=1]')
  .action(async (message, result) => {
    requireAdmin(message);
    
    const page = result.args.page || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    const users = await db.query('SELECT * FROM users LIMIT ? OFFSET ?', [limit, offset]);
    const total = await db.query('SELECT COUNT(*) as count FROM users');
    
    let response = `👥 用户列表 (第${page}页)\n\n`;
    users.forEach((user, index) => {
      response += `${offset + index + 1}. ${user.name} (${user.id})\n`;
    });
    response += `\n总计: ${total[0].count} 用户`;
    
    return response;
  })
);

// 群组管理命令
addCommand(new MessageCommand('group mute <userId:text> [duration:number=300]')
  .action(async (message, result) => {
    requireAdmin(message);
    
    const { userId, duration } = result.args;
    const groupId = message.$channel.id;
    
    try {
      await message.$reply(`🔇 用户 ${userId} 已被禁言 ${duration} 秒`);
      
      // 这里应该调用实际的禁言API
      // await bot.setGroupBan(groupId, userId, duration);
      
      // 记录操作日志
      await db.query('INSERT INTO admin_logs (action, target, operator, timestamp) VALUES (?, ?, ?, ?)',
        ['mute', userId, message.$sender.id, Date.now()]);
      
      return `✅ 禁言操作已记录`;
    } catch (error) {
      logger.error('禁言操作失败:', error);
      return `❌ 禁言操作失败: ${error.message}`;
    }
  })
);
```

## 🔄 热重载开发

### 开发环境配置
```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'dev-bot',
        context: 'process'
      }
    ],
    plugins: [
      'adapter-process',
      'http',
      'console',
      'my-plugin'
    ],
    debug: true,
    hmr: {
      enabled: true,
      watch: ['./src/plugins/**/*.ts'],
      ignore: ['**/*.test.ts', '**/*.spec.ts']
    }
  };
});
```

### 热重载插件
```typescript
// src/plugins/hot-reload-plugin.ts
import { usePlugin, useLogger, onMounted, onDispose } from 'zhin.js';

const plugin = usePlugin();
const logger = useLogger();

let fileWatcher: any;
let reloadCount = 0;

onMounted(() => {
  logger.info('热重载插件已启动');
  
  // 监听文件变化
  const chokidar = require('chokidar');
  fileWatcher = chokidar.watch('./src/plugins/**/*.ts', {
    ignored: /(^|[\/\\])\../, // 忽略点文件
    persistent: true
  });
  
  fileWatcher.on('change', (path: string) => {
    logger.info(`文件变化: ${path}`);
    reloadCount++;
    
    // 触发热重载
    plugin.emit('hmr.reload', { path, count: reloadCount });
  });
  
  fileWatcher.on('error', (error: any) => {
    logger.error('文件监听错误:', error);
  });
});

onDispose(() => {
  if (fileWatcher) {
    fileWatcher.close();
    logger.info('文件监听器已关闭');
  }
});

// 提供重载统计
addCommand(new MessageCommand('reload stats')
  .action(async () => {
    return `🔄 热重载统计:\n- 重载次数: ${reloadCount}\n- 监听文件: ./src/plugins/**/*.ts`;
  })
);
```

## 📊 数据持久化

### 数据库集成
```typescript
// src/plugins/database-plugin.ts
import { register, useContext, useLogger } from 'zhin.js';
import Database from 'better-sqlite3';

const logger = useLogger();

register({
  name: 'database',
  description: 'SQLite 数据库服务',
  async mounted() {
    const db = new Database('./data/bot.db');
    
    // 创建表
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_seen INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
      
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
    `);
    
    logger.info('数据库已初始化');
    
    return {
      query: (sql: string, params: any[] = []) => {
        try {
          const stmt = db.prepare(sql);
          if (sql.trim().toLowerCase().startsWith('select')) {
            return stmt.all(params);
          } else {
            return stmt.run(params);
          }
        } catch (error) {
          logger.error('数据库查询失败:', error);
          throw error;
        }
      },
      
      transaction: (callback: (db: any) => void) => {
        const transaction = db.transaction(callback);
        return transaction;
      },
      
      close: () => {
        db.close();
        logger.info('数据库连接已关闭');
      }
    };
  },
  
  async dispose(db) {
    db.close();
  }
});
```

### 缓存系统
```typescript
// src/plugins/cache-plugin.ts
import { register, useContext, useLogger } from 'zhin.js';

const logger = useLogger();

interface CacheItem<T> {
  value: T;
  expires: number;
}

class CacheManager {
  private cache = new Map<string, CacheItem<any>>();
  private timers = new Map<string, NodeJS.Timeout>();
  
  set<T>(key: string, value: T, ttl: number = 300000): void {
    // 清除现有定时器
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // 设置缓存项
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    });
    
    // 设置过期定时器
    const timer = setTimeout(() => {
      this.delete(key);
    }, ttl);
    
    this.timers.set(key, timer);
    
    logger.debug(`缓存已设置: ${key} (TTL: ${ttl}ms)`);
  }
  
  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }
    
    if (Date.now() > item.expires) {
      this.delete(key);
      return null;
    }
    
    return item.value;
  }
  
  delete(key: string): boolean {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    
    return this.cache.delete(key);
  }
  
  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
  
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

register({
  name: 'cache',
  description: '内存缓存服务',
  async mounted() {
    const cache = new CacheManager();
    
    logger.info('缓存服务已启动');
    
    return cache;
  }
});
```

## 🔌 多平台适配

### 跨平台消息处理
```typescript
// src/plugins/cross-platform-plugin.ts
import { onMessage, addCommand, MessageCommand, useLogger } from 'zhin.js';

const logger = useLogger();

// 跨平台消息转发
onMessage(async (message) => {
  // 只处理特定关键词的消息
  if (message.$raw.includes('转发')) {
    const targetPlatform = message.$raw.split('转发')[1]?.trim();
    
    if (targetPlatform) {
      try {
        // 根据平台转发消息
        await forwardMessage(message, targetPlatform);
        await message.$reply(`✅ 消息已转发到 ${targetPlatform}`);
      } catch (error) {
        logger.error('消息转发失败:', error);
        await message.$reply(`❌ 转发失败: ${error.message}`);
      }
    }
  }
});

async function forwardMessage(sourceMessage: Message, targetPlatform: string) {
  const content = `📨 来自 ${sourceMessage.adapter} 的转发消息:\n${sourceMessage.raw}`;
  
  // 这里应该根据目标平台发送消息
  // 实际实现需要根据具体的适配器API
  switch (targetPlatform) {
    case 'qq':
      // await qqBot.sendMessage(content);
      break;
    case 'discord':
      // await discordBot.sendMessage(content);
      break;
    case 'telegram':
      // await telegramBot.sendMessage(content);
      break;
    default:
      throw new Error(`不支持的平台: ${targetPlatform}`);
  }
}

// 跨平台统计命令
addCommand(new MessageCommand('stats all')
  .action(async (message) => {
    const stats = await getCrossPlatformStats();
    
    let response = '📊 跨平台统计:\n\n';
    for (const [platform, data] of Object.entries(stats)) {
      response += `**${platform}**:\n`;
      response += `- 消息数: ${data.messages}\n`;
      response += `- 用户数: ${data.users}\n`;
      response += `- 在线状态: ${data.online ? '🟢' : '🔴'}\n\n`;
    }
    
    return response;
  })
);

async function getCrossPlatformStats() {
  // 这里应该从各个平台获取统计信息
  return {
    qq: { messages: 1234, users: 56, online: true },
    discord: { messages: 567, users: 23, online: true },
    telegram: { messages: 890, users: 34, online: false }
  };
}
```

## 🎨 函数式组件系统

### 消息组件系统
```typescript
// src/plugins/component-plugin.ts
import { defineComponent, segment } from 'zhin.js';

// 卡片组件 - 函数式组件
const CardComponent = defineComponent(async function CardComponent(props: {
  title: string;
  content: string;
  color?: string;
  children?: string;
}, context) {
  const colorMap = {
    blue: '🔵',
    green: '🟢',
    red: '🔴',
    yellow: '🟡'
  };
  
  const icon = colorMap[props.color || 'blue'] || '🔵';
  const content = props.children || props.content;
  
  return [
    segment('text', { text: `${icon} **${props.title}**\n` }),
    segment('text', { text: content }),
    segment('text', { text: '\n' + '─'.repeat(20) })
  ];
}, 'card');

// 进度条组件 - 函数式组件
const ProgressComponent = defineComponent(async function ProgressComponent(props: {
  value: number;
  max?: number;
  width?: number;
}, context) {
  const max = props.max || 100;
  const width = props.width || 20;
  const percentage = Math.min(100, Math.max(0, (props.value / max) * 100));
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  return [
    segment('text', { text: `进度: ${bar} ${percentage.toFixed(1)}%` })
  ];
}, 'progress');

// 表格组件 - 函数式组件
const TableComponent = defineComponent(async function TableComponent(props: {
  headers: string[];
  rows: string[][];
  border?: boolean;
}, context) {
  if (!props.headers || !props.rows) {
    return [segment('text', { text: '表格数据不完整' })];
  }
  
  let table = '';
  const border = props.border !== false;
  
  if (border) {
    const separator = '┌' + '─'.repeat(20) + '┬' + '─'.repeat(20) + '┐\n';
    table += separator;
  }
  
  // 表头
  table += '│ ' + props.headers.join(' │ ') + ' │\n';
  
  if (border) {
    table += '├' + '─'.repeat(20) + '┼' + '─'.repeat(20) + '┤\n';
  }
  
  // 数据行
  props.rows.forEach(row => {
    table += '│ ' + row.join(' │ ') + ' │\n';
  });
  
  if (border) {
    table += '└' + '─'.repeat(20) + '┴' + '─'.repeat(20) + '┘';
  }
  
  return [segment('text', { text: table })];
}, 'table');

// 条件渲染组件 - 函数式组件
const ConditionalComponent = defineComponent(async function ConditionalComponent(props: {
  condition: boolean;
  children?: string;
  fallback?: string;
}, context) {
  if (props.condition) {
    return props.children || '';
  }
  return props.fallback || '';
}, 'conditional');

// 列表组件 - 使用 Fragment 和 children
const ListComponent = defineComponent(async function ListComponent(props: {
  items: string[];
  children?: string;
}, context) {
  const items = props.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
  const header = props.children ? `\n=== ${props.children} ===\n` : '';
  return `${header}${items}`;
}, 'list');

// 使用示例命令
addCommand(new MessageCommand('demo components')
  .action(async () => {
    return [
      // 使用卡片组件
      segment('card', { 
        title: '组件演示', 
        content: '这是一个卡片组件示例',
        color: 'blue'
      }),
      
      // 使用进度条组件
      segment('progress', { value: 75, max: 100, width: 15 }),
      
      // 使用表格组件
      segment('table', {
        headers: ['姓名', '年龄'],
        rows: [
          ['张三', '25'],
          ['李四', '30']
        ]
      }),
      
      // 使用条件渲染组件
      segment('conditional', { 
        condition: true,
        children: '条件为真时显示的内容'
      }),
      
      // 使用列表组件
      segment('list', {
        items: ['功能1', '功能2', '功能3'],
        children: '功能列表'
      })
    ];
  })
);

// 使用模板语法
addCommand(new MessageCommand('demo template')
  .action(async () => {
    return `
<Card title="用户信息" color="green">
  <List items={["特性1", "特性2", "特性3"]}>功能列表</List>
  <Progress value={60} max={100} width={20} />
</Card>
    `;
  })
);
```

## 🔗 相关链接

- [基础用法示例](./basic-usage.md)
- [插件开发指南](../plugin/development.md)
- [适配器开发指南](../adapter/development.md)
