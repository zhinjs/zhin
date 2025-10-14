# 🚀 基础用法示例

展示 Zhin.js 框架的基本用法和常见场景。

## 🎯 快速开始

### 最简单的机器人
```typescript
// src/index.ts
import { createApp } from 'zhin.js';

const app = await createApp();
await app.start();

console.log('机器人已启动！');
```

### 基础配置
```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'my-bot',
        context: 'process' // 使用控制台适配器
      }
    ],
    plugins: [
      'adapter-process', // 控制台适配器
      'my-plugin'        // 你的插件
    ],
    debug: true
  };
});
```

## 💬 消息处理

### 基础消息响应
```typescript
// src/plugins/hello-plugin.ts
import { onMessage, useLogger } from 'zhin.js';

const logger = useLogger();

onMessage(async (message) => {
  if (message.$raw === '你好') {
    await message.$reply('你好！我是 Zhin 机器人！');
  }
  
  if (message.$raw.includes('时间')) {
    const now = new Date().toLocaleString();
    await message.$reply(`现在时间是：${now}`);
  }
});

logger.info('Hello 插件已加载');
```

### 私聊和群聊处理
```typescript
// src/plugins/chat-plugin.ts
import { onPrivateMessage, onGroupMessage, useLogger } from 'zhin.js';

const logger = useLogger();

// 私聊消息处理
onPrivateMessage(async (message) => {
  logger.info(`收到私聊消息: ${message.$raw}`);
  await message.$reply('这是私聊消息！');
});

// 群聊消息处理
onGroupMessage(async (message) => {
  if (message.$raw.includes('@机器人')) {
    await message.$reply('我在！有什么可以帮助你的吗？');
  }
});
```

## 🎮 命令系统

### 简单命令
```typescript
// src/plugins/command-plugin.ts
import { addCommand, MessageCommand, useLogger } from 'zhin.js';

const logger = useLogger();

// Ping 命令
addCommand(new MessageCommand('ping')
  .action(async () => {
    return '🏓 Pong!';
  })
);

// 帮助命令
addCommand(new MessageCommand('help')
  .action(async () => {
    return `🤖 可用命令：
- ping: 测试连接
- help: 显示帮助
- time: 显示时间
- weather <城市>: 查询天气`;
  })
);

logger.info('命令插件已加载');
```

### 带参数的命令
```typescript
// src/plugins/weather-plugin.ts
import { addCommand, MessageCommand, useLogger } from 'zhin.js';

const logger = useLogger();

// 天气查询命令
addCommand(new MessageCommand('weather <city:text>')
  .action(async (message, result) => {
    const city = result.args.city;
    
    // 模拟天气查询
    const weather = await getWeather(city);
    
    return `🌤️ ${city} 天气：
温度：${weather.temperature}°C
天气：${weather.description}
湿度：${weather.humidity}%`;
  })
);

// 计算命令
addCommand(new MessageCommand('calc <expression:text>')
  .action(async (message, result) => {
    try {
      const expression = result.args.expression;
      const result = eval(expression); // 注意：生产环境中应该使用安全的表达式解析器
      
      return `🧮 计算结果：${expression} = ${result}`;
    } catch (error) {
      return '❌ 计算表达式无效';
    }
  })
);

async function getWeather(city: string) {
  // 模拟天气API调用
  return {
    temperature: Math.floor(Math.random() * 30) + 5,
    description: '晴天',
    humidity: Math.floor(Math.random() * 40) + 40
  };
}

logger.info('天气插件已加载');
```

### 可选参数命令
```typescript
// src/plugins/dice-plugin.ts
import { addCommand, MessageCommand, useLogger } from 'zhin.js';

const logger = useLogger();

// 骰子命令
addCommand(new MessageCommand('roll [sides:number=6]')
  .action(async (message, result) => {
    const sides = result.args.sides || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    
    return `🎲 你掷出了 ${roll} 点！（${sides} 面骰子）`;
  })
);

// 随机数命令
addCommand(new MessageCommand('random [min:number=1] [max:number=100]')
  .action(async (message, result) => {
    const min = result.args.min || 1;
    const max = result.args.max || 100;
    const random = Math.floor(Math.random() * (max - min + 1)) + min;
    
    return `🎯 随机数：${random} (范围: ${min}-${max})`;
  })
);

logger.info('骰子插件已加载');
```

## 🧩 插件开发

### 基础插件结构
```typescript
// src/plugins/my-plugin.ts
import { 
  usePlugin, 
  useLogger, 
  onMounted, 
  onDispose,
  addCommand,
  MessageCommand
} from 'zhin.js';

const plugin = usePlugin();
const logger = useLogger();

// 插件挂载时执行
onMounted(() => {
  logger.info(`插件 ${plugin.name} 已挂载`);
  
  // 可以在这里初始化插件资源
  initializePlugin();
});

// 插件卸载时执行
onDispose(() => {
  logger.info(`插件 ${plugin.name} 即将卸载`);
  
  // 清理插件资源
  cleanupPlugin();
});

function initializePlugin() {
  // 初始化逻辑
  logger.info('插件初始化完成');
}

function cleanupPlugin() {
  // 清理逻辑
  logger.info('插件清理完成');
}

// 添加命令
addCommand(new MessageCommand('plugin info')
  .action(async () => {
    return `📦 插件信息：
名称：${plugin.name}
文件：${plugin.filename}
状态：运行中`;
  })
);
```

### 插件配置
```typescript
// src/plugins/config-plugin.ts
import { usePlugin, useLogger, addCommand, MessageCommand } from 'zhin.js';

const plugin = usePlugin();
const logger = useLogger();

// 获取插件配置
const config = plugin.config as {
  apiKey?: string;
  maxRequests?: number;
  timeout?: number;
};

logger.info('插件配置:', config);

addCommand(new MessageCommand('config')
  .action(async () => {
    return `⚙️ 当前配置：
API Key: ${config.apiKey ? '已设置' : '未设置'}
最大请求数: ${config.maxRequests || '未设置'}
超时时间: ${config.timeout || '未设置'}ms`;
  })
);
```

## 🔧 中间件系统

### 消息中间件
```typescript
// src/plugins/middleware-plugin.ts
import { addMiddleware, useLogger } from 'zhin.js';

const logger = useLogger();

// 日志中间件
addMiddleware(async (message, next) => {
  const start = Date.now();
  logger.info(`收到消息: ${message.$raw}`);
  
  await next();
  
  const duration = Date.now() - start;
  logger.info(`消息处理完成，耗时: ${duration}ms`);
});

// 权限检查中间件
addMiddleware(async (message, next) => {
  // 检查是否是管理员
  const adminUsers = ['123456789', '987654321'];
  
  if (message.$raw.startsWith('admin') && !adminUsers.includes(message.$sender.id)) {
    await message.$reply('❌ 权限不足');
    return;
  }
  
  await next();
});

// 频率限制中间件
const userLastMessage = new Map<string, number>();
const RATE_LIMIT = 1000; // 1秒

addMiddleware(async (message, next) => {
  const userId = message.$sender.id;
  const now = Date.now();
  const lastMessage = userLastMessage.get(userId);
  
  if (lastMessage && now - lastMessage < RATE_LIMIT) {
    await message.$reply('⏰ 消息发送过于频繁，请稍后再试');
    return;
  }
  
  userLastMessage.set(userId, now);
  await next();
});
```

## 📊 数据存储

### 简单数据存储
```typescript
// src/plugins/storage-plugin.ts
import { addCommand, MessageCommand, useLogger } from 'zhin.js';

const logger = useLogger();

// 简单的内存存储
const storage = new Map<string, any>();

addCommand(new MessageCommand('set <key:text> <value:text>')
  .action(async (message, result) => {
    const { key, value } = result.args;
    storage.set(key, value);
    
    return `✅ 已设置 ${key} = ${value}`;
  })
);

addCommand(new MessageCommand('get <key:text>')
  .action(async (message, result) => {
    const key = result.args.key;
    const value = storage.get(key);
    
    if (value === undefined) {
      return `❌ 键 ${key} 不存在`;
    }
    
    return `📝 ${key} = ${value}`;
  })
);

addCommand(new MessageCommand('list')
  .action(async () => {
    const keys = Array.from(storage.keys());
    
    if (keys.length === 0) {
      return '📝 存储为空';
    }
    
    let response = '📝 存储内容：\n';
    keys.forEach(key => {
      response += `- ${key}: ${storage.get(key)}\n`;
    });
    
    return response;
  })
);

logger.info('存储插件已加载');
```

## 🎨 富文本消息

### 消息段使用
```typescript
// src/plugins/rich-message-plugin.ts
import { addCommand, MessageCommand, segment, useLogger } from 'zhin.js';

const logger = useLogger();

addCommand(new MessageCommand('rich')
  .action(async (message) => {
    return [
      segment('text', { text: '🎨 富文本消息示例：\n\n' }),
      segment('text', { text: '📝 普通文本\n' }),
      segment('at', { id: message.$sender.id, name: message.$sender.name }),
      segment('text', { text: ' 这是@你的消息\n' }),
      segment('face', { id: '1', name: '微笑' }),
      segment('text', { text: ' 这是表情\n' }),
      segment('image', { url: 'https://example.com/image.jpg' }),
      segment('text', { text: '\n这是图片' })
    ];
  })
);

addCommand(new MessageCommand('card')
  .action(async () => {
    return [
      segment('text', { text: '┌─────────────────┐\n' }),
      segment('text', { text: '│  🎴 卡片示例    │\n' }),
      segment('text', { text: '├─────────────────┤\n' }),
      segment('text', { text: '│ 这是一个卡片    │\n' }),
      segment('text', { text: '│ 可以包含各种    │\n' }),
      segment('text', { text: '│ 富文本内容      │\n' }),
      segment('text', { text: '└─────────────────┘' })
    ];
  })
);

logger.info('富文本消息插件已加载');
```

## 🔗 相关链接

- [高级用法示例](./advanced-usage.md)
- [插件开发指南](../plugin/development.md)
- [API 参考](../api/index.md)
