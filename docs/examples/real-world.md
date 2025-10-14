# 🌍 真实世界示例

展示 Zhin.js 框架在实际项目中的应用场景。

## 🏢 企业级机器人

### 客服机器人
```typescript
// src/plugins/customer-service-plugin.ts
import { 
  addCommand, 
  MessageCommand, 
  onMessage, 
  useContext,
  useLogger,
  register
} from 'zhin.js';

const logger = useLogger();

// 注册客服服务
register({
  name: 'customer-service',
  description: '客服系统',
  async mounted() {
    return {
      async createTicket(userId: string, issue: string) {
        const ticketId = `T${Date.now()}`;
        // 创建工单逻辑
        logger.info(`创建工单 ${ticketId} 给用户 ${userId}`);
        return ticketId;
      },
      
      async getTicketStatus(ticketId: string) {
        // 查询工单状态
        return { status: '处理中', priority: '中等' };
      }
    };
  }
});

// 工单创建命令
addCommand(new MessageCommand('ticket <issue:text>')
  .action(async (message, result) => {
    const service = useContext('customer-service');
    const ticketId = await service.createTicket(message.$sender.id, result.args.issue);
    
    return `🎫 工单已创建！
工单号：${ticketId}
问题：${result.args.issue}
状态：已提交，客服将在24小时内回复`;
  })
);

// 工单查询命令
addCommand(new MessageCommand('status <ticketId:text>')
  .action(async (message, result) => {
    const service = useContext('customer-service');
    const status = await service.getTicketStatus(result.args.ticketId);
    
    return `📋 工单状态：
工单号：${result.args.ticketId}
状态：${status.status}
优先级：${status.priority}`;
  })
);

// 智能回复
onMessage(async (message) => {
  const keywords = {
    '退款': '请提供订单号，我们将为您处理退款申请',
    '发货': '请提供订单号，我们为您查询物流信息',
    '密码': '请通过官方渠道重置密码，或联系客服协助',
    '账号': '请提供相关信息，我们为您查询账号状态'
  };
  
  for (const [keyword, reply] of Object.entries(keywords)) {
    if (message.$raw.includes(keyword)) {
      await message.$reply(`🤖 自动回复：${reply}`);
      break;
    }
  }
});
```

### 项目管理机器人
```typescript
// src/plugins/project-management-plugin.ts
import { addCommand, MessageCommand, useContext, useLogger } from 'zhin.js';

const logger = useLogger();

interface Task {
  id: string;
  title: string;
  assignee: string;
  status: 'todo' | 'in-progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  createdAt: number;
}

class ProjectManager {
  private tasks = new Map<string, Task>();
  private nextId = 1;
  
  createTask(title: string, assignee: string, priority: 'low' | 'medium' | 'high' = 'medium'): Task {
    const task: Task = {
      id: `T${this.nextId++}`,
      title,
      assignee,
      status: 'todo',
      priority,
      createdAt: Date.now()
    };
    
    this.tasks.set(task.id, task);
    return task;
  }
  
  updateTaskStatus(taskId: string, status: Task['status']): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      return true;
    }
    return false;
  }
  
  getTasksByAssignee(assignee: string): Task[] {
    return Array.from(this.tasks.values()).filter(task => task.assignee === assignee);
  }
  
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}

const projectManager = new ProjectManager();

// 创建任务命令
addCommand(new MessageCommand('task create <title:text> <assignee:text> [priority:text=medium]')
  .action(async (message, result) => {
    const { title, assignee, priority } = result.args;
    const task = projectManager.createTask(title, assignee, priority as any);
    
    return `✅ 任务已创建！
ID: ${task.id}
标题: ${task.title}
负责人: ${task.assignee}
优先级: ${task.priority}
状态: ${task.status}`;
  })
);

// 更新任务状态
addCommand(new MessageCommand('task update <taskId:text> <status:text>')
  .action(async (message, result) => {
    const { taskId, status } = result.args;
    const validStatuses = ['todo', 'in-progress', 'done'];
    
    if (!validStatuses.includes(status)) {
      return `❌ 无效状态，请使用: ${validStatuses.join(', ')}`;
    }
    
    const success = projectManager.updateTaskStatus(taskId, status as any);
    if (success) {
      return `✅ 任务 ${taskId} 状态已更新为 ${status}`;
    } else {
      return `❌ 任务 ${taskId} 不存在`;
    }
  })
);

// 查看我的任务
addCommand(new MessageCommand('my tasks')
  .action(async (message) => {
    const tasks = projectManager.getTasksByAssignee(message.$sender.id);
    
    if (tasks.length === 0) {
      return '📝 您当前没有任务';
    }
    
    let response = '📋 您的任务：\n\n';
    tasks.forEach(task => {
      const statusEmoji = {
        'todo': '⏳',
        'in-progress': '🔄',
        'done': '✅'
      };
      
      response += `${statusEmoji[task.status]} **${task.title}** (${task.id})\n`;
      response += `   优先级: ${task.priority} | 状态: ${task.status}\n\n`;
    });
    
    return response;
  })
);

// 查看所有任务
addCommand(new MessageCommand('tasks all')
  .action(async () => {
    const tasks = projectManager.getAllTasks();
    
    if (tasks.length === 0) {
      return '📝 当前没有任务';
    }
    
    let response = '📋 所有任务：\n\n';
    tasks.forEach(task => {
      const statusEmoji = {
        'todo': '⏳',
        'in-progress': '🔄',
        'done': '✅'
      };
      
      response += `${statusEmoji[task.status]} **${task.title}** (${task.id})\n`;
      response += `   负责人: ${task.assignee} | 优先级: ${task.priority}\n\n`;
    });
    
    return response;
  })
);
```

## 🎮 游戏机器人

### 猜数字游戏
```typescript
// src/plugins/guess-number-plugin.ts
import { addCommand, MessageCommand, onMessage, useLogger } from 'zhin.js';

const logger = useLogger();

interface GameSession {
  userId: string;
  number: number;
  attempts: number;
  maxAttempts: number;
  startTime: number;
}

const gameSessions = new Map<string, GameSession>();

// 开始游戏命令
addCommand(new MessageCommand('guess start [max:number=100]')
  .action(async (message, result) => {
    const userId = message.$sender.id;
    const max = result.args.max || 100;
    
    // 检查是否已有游戏进行中
    if (gameSessions.has(userId)) {
      return '🎮 您已有游戏进行中，请先完成当前游戏';
    }
    
    const session: GameSession = {
      userId,
      number: Math.floor(Math.random() * max) + 1,
      attempts: 0,
      maxAttempts: Math.ceil(Math.log2(max)) + 2,
      startTime: Date.now()
    };
    
    gameSessions.set(userId, session);
    
    return `🎮 猜数字游戏开始！
范围：1-${max}
最大尝试次数：${session.maxAttempts}
输入数字开始猜测！`;
  })
);

// 猜测命令
addCommand(new MessageCommand('guess <number:number>')
  .action(async (message, result) => {
    const userId = message.$sender.id;
    const session = gameSessions.get(userId);
    
    if (!session) {
      return '❌ 请先开始游戏：guess start';
    }
    
    const guess = result.args.number;
    session.attempts++;
    
    if (guess === session.number) {
      const duration = Date.now() - session.startTime;
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      
      gameSessions.delete(userId);
      
      return `🎉 恭喜！猜对了！
答案：${session.number}
尝试次数：${session.attempts}
用时：${minutes}分${seconds}秒`;
    }
    
    if (session.attempts >= session.maxAttempts) {
      gameSessions.delete(userId);
      return `💀 游戏结束！
正确答案：${session.number}
尝试次数：${session.attempts}/${session.maxAttempts}`;
    }
    
    const hint = guess > session.number ? '太大了' : '太小了';
    const remaining = session.maxAttempts - session.attempts;
    
    return `🤔 ${hint}！
尝试次数：${session.attempts}/${session.maxAttempts}
剩余次数：${remaining}`;
  })
);

// 放弃游戏命令
addCommand(new MessageCommand('guess quit')
  .action(async (message) => {
    const userId = message.$sender.id;
    const session = gameSessions.get(userId);
    
    if (!session) {
      return '❌ 您当前没有进行中的游戏';
    }
    
    gameSessions.delete(userId);
    return `😔 游戏已放弃！
正确答案：${session.number}
尝试次数：${session.attempts}`;
  })
);
```

### 文字冒险游戏
```typescript
// src/plugins/text-adventure-plugin.ts
import { addCommand, MessageCommand, useLogger } from 'zhin.js';

const logger = useLogger();

interface GameState {
  userId: string;
  location: string;
  inventory: string[];
  health: number;
  score: number;
}

const gameStates = new Map<string, GameState>();

const gameMap = {
  'start': {
    description: '你站在一个神秘的洞穴入口前，里面传来奇怪的声音。',
    exits: ['cave'],
    items: ['torch']
  },
  'cave': {
    description: '洞穴内部很暗，只有微弱的火光。你看到前方有两条路。',
    exits: ['treasure', 'monster'],
    items: ['sword']
  },
  'treasure': {
    description: '你发现了一个宝箱！里面闪闪发光。',
    exits: ['cave'],
    items: ['gold', 'potion']
  },
  'monster': {
    description: '一只巨大的怪物挡住了去路！',
    exits: ['cave'],
    items: []
  }
};

// 开始冒险命令
addCommand(new MessageCommand('adventure start')
  .action(async (message) => {
    const userId = message.$sender.id;
    
    if (gameStates.has(userId)) {
      return '🎮 您已有冒险进行中，请先完成当前冒险';
    }
    
    const state: GameState = {
      userId,
      location: 'start',
      inventory: [],
      health: 100,
      score: 0
    };
    
    gameStates.set(userId, state);
    
    return `🎮 冒险开始！
${gameMap[state.location].description}

可用命令：
- look: 查看当前位置
- go <方向>: 移动到指定方向
- take <物品>: 拾取物品
- inventory: 查看背包
- use <物品>: 使用物品`;
  })
);

// 查看命令
addCommand(new MessageCommand('look')
  .action(async (message) => {
    const userId = message.$sender.id;
    const state = gameStates.get(userId);
    
    if (!state) {
      return '❌ 请先开始冒险：adventure start';
    }
    
    const location = gameMap[state.location];
    let response = `📍 当前位置：${state.location}\n\n`;
    response += `${location.description}\n\n`;
    
    if (location.exits.length > 0) {
      response += `🚪 可前往：${location.exits.join(', ')}\n`;
    }
    
    if (location.items.length > 0) {
      response += `📦 可拾取：${location.items.join(', ')}\n`;
    }
    
    response += `\n❤️ 生命值：${state.health}\n`;
    response += `⭐ 分数：${state.score}`;
    
    return response;
  })
);

// 移动命令
addCommand(new MessageCommand('go <direction:text>')
  .action(async (message, result) => {
    const userId = message.$sender.id;
    const state = gameStates.get(userId);
    
    if (!state) {
      return '❌ 请先开始冒险：adventure start';
    }
    
    const direction = result.args.direction;
    const location = gameMap[state.location];
    
    if (!location.exits.includes(direction)) {
      return `❌ 无法前往 ${direction}，可用方向：${location.exits.join(', ')}`;
    }
    
    state.location = direction;
    
    // 特殊事件处理
    if (direction === 'monster') {
      state.health -= 20;
      if (state.health <= 0) {
        gameStates.delete(userId);
        return `💀 你被怪物击败了！游戏结束！\n最终分数：${state.score}`;
      }
      return `⚔️ 你遇到了怪物！生命值 -20\n当前生命值：${state.health}`;
    }
    
    if (direction === 'treasure') {
      state.score += 100;
      return `💰 你发现了宝藏！分数 +100\n当前分数：${state.score}`;
    }
    
    return `✅ 已移动到 ${direction}`;
  })
);

// 拾取物品命令
addCommand(new MessageCommand('take <item:text>')
  .action(async (message, result) => {
    const userId = message.$sender.id;
    const state = gameStates.get(userId);
    
    if (!state) {
      return '❌ 请先开始冒险：adventure start';
    }
    
    const item = result.args.item;
    const location = gameMap[state.location];
    
    if (!location.items.includes(item)) {
      return `❌ 这里没有 ${item}，可用物品：${location.items.join(', ')}`;
    }
    
    state.inventory.push(item);
    location.items.splice(location.items.indexOf(item), 1);
    
    return `✅ 已拾取 ${item}`;
  })
);

// 查看背包命令
addCommand(new MessageCommand('inventory')
  .action(async (message) => {
    const userId = message.$sender.id;
    const state = gameStates.get(userId);
    
    if (!state) {
      return '❌ 请先开始冒险：adventure start';
    }
    
    if (state.inventory.length === 0) {
      return '📦 背包是空的';
    }
    
    return `📦 背包内容：\n${state.inventory.map(item => `- ${item}`).join('\n')}`;
  })
);
```

## 📊 数据分析机器人

### 数据统计机器人
```typescript
// src/plugins/analytics-plugin.ts
import { addCommand, MessageCommand, onMessage, useLogger } from 'zhin.js';

const logger = useLogger();

interface MessageStats {
  userId: string;
  messageCount: number;
  commandCount: number;
  lastActive: number;
  joinDate: number;
}

const userStats = new Map<string, MessageStats>();
const globalStats = {
  totalMessages: 0,
  totalCommands: 0,
  activeUsers: 0,
  startTime: Date.now()
};

// 消息统计中间件
onMessage(async (message, next) => {
  const userId = message.$sender.id;
  
  // 更新用户统计
  if (!userStats.has(userId)) {
    userStats.set(userId, {
      userId,
      messageCount: 0,
      commandCount: 0,
      lastActive: Date.now(),
      joinDate: Date.now()
    });
  }
  
  const userStat = userStats.get(userId)!;
  userStat.messageCount++;
  userStat.lastActive = Date.now();
  
  // 更新全局统计
  globalStats.totalMessages++;
  
  // 检查是否是命令
  if (message.$raw.startsWith('/') || message.$raw.startsWith('!')) {
    userStat.commandCount++;
    globalStats.totalCommands++;
  }
  
  await next();
});

// 统计命令
addCommand(new MessageCommand('stats')
  .action(async (message) => {
    const userId = message.$sender.id;
    const userStat = userStats.get(userId);
    
    if (!userStat) {
      return '❌ 没有找到您的统计数据';
    }
    
    const now = Date.now();
    const daysSinceJoin = Math.floor((now - userStat.joinDate) / (1000 * 60 * 60 * 24));
    const hoursSinceActive = Math.floor((now - userStat.lastActive) / (1000 * 60 * 60));
    
    return `📊 您的统计信息：
消息数：${userStat.messageCount}
命令数：${userStat.commandCount}
加入天数：${daysSinceJoin}
最后活跃：${hoursSinceActive}小时前`;
  })
);

// 全局统计命令
addCommand(new MessageCommand('stats global')
  .action(async () => {
    const now = Date.now();
    const uptime = Math.floor((now - globalStats.startTime) / (1000 * 60 * 60 * 24));
    const activeUsers = Array.from(userStats.values()).filter(
      stat => now - stat.lastActive < 24 * 60 * 60 * 1000
    ).length;
    
    return `📊 全局统计信息：
总消息数：${globalStats.totalMessages}
总命令数：${globalStats.totalCommands}
活跃用户：${activeUsers}
运行天数：${uptime}`;
  })
);

// 排行榜命令
addCommand(new MessageCommand('leaderboard [type:text=messages]')
  .action(async (message, result) => {
    const type = result.args.type;
    
    let sortedUsers: Array<{ userId: string; value: number; name?: string }> = [];
    
    if (type === 'messages') {
      sortedUsers = Array.from(userStats.values())
        .map(stat => ({ userId: stat.userId, value: stat.messageCount }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    } else if (type === 'commands') {
      sortedUsers = Array.from(userStats.values())
        .map(stat => ({ userId: stat.userId, value: stat.commandCount }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    } else {
      return '❌ 无效类型，请使用 messages 或 commands';
    }
    
    let response = `🏆 ${type} 排行榜：\n\n`;
    sortedUsers.forEach((user, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
      response += `${medal} ${index + 1}. ${user.userId}: ${user.value}\n`;
    });
    
    return response;
  })
);
```

## 🔗 相关链接

- [基础用法示例](./basic-usage.md)
- [高级用法示例](./advanced-usage.md)
- [插件开发指南](../plugin/development.md)
