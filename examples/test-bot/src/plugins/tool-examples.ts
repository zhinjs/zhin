/**
 * Tool 系统测试用例
 * 
 * 演示：
 * 1. 简单工具定义 - 计算器
 * 2. 多参数工具 - 翻译器
 * 3. 命令转工具 - 现有命令自动变成 AI 可用的工具
 * 4. 纯 AI 工具 - 不生成命令，仅供 AI 调用
 */
import { usePlugin, defineTool, MessageCommand, Tool } from 'zhin.js';

const plugin = usePlugin();
const { logger, addCommand } = plugin;

// ============================================================================
// 示例 1: 简单计算器工具
// ============================================================================

const calculatorTool = defineTool<{ expression: string }>({
  name: 'calculator',
  description: '计算数学表达式，支持加减乘除和括号',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，如 "2 + 3 * 4" 或 "(10 - 5) / 2"',
      },
    },
    required: ['expression'],
  },
  command: {
    pattern: 'calc <expression:rest>',
    alias: ['计算'],
    usage: ['计算数学表达式'],
    examples: ['/calc 2 + 3 * 4', '/计算 (10 - 5) / 2'],
  },
  execute: async (args) => {
    const { expression } = args;
    try {
      // 安全计算：只允许数字和基本运算符
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
      // 检查是否有非法字符被移除
      if (sanitized.replace(/\s/g, '') !== expression.replace(/\s/g, '')) {
        return '❌ 表达式包含非法字符';
      }
      
      // 使用框架的安全沙箱执行
      const { evaluate } = await import('@zhin.js/kernel');
      const result = evaluate(sanitized, {});
      
      if (typeof result !== 'number' || !isFinite(result)) {
        return '❌ 计算结果无效';
      }
      
      return `🔢 ${expression} = ${result}`;
    } catch (error) {
      return `❌ 计算失败: ${error instanceof Error ? error.message : '表达式无效'}`;
    }
  },
});

plugin.addTool(calculatorTool);

// ============================================================================
// 示例 2: 翻译工具（多参数）
// ============================================================================

const translateTool = defineTool<{ text: string; from?: string; to?: string }>({
  name: 'translate',
  description: '翻译文本，支持中英互译',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '要翻译的文本',
      },
      from: {
        type: 'string',
        description: '源语言 (zh/en/auto)，默认 auto',
      },
      to: {
        type: 'string',
        description: '目标语言 (zh/en)，默认根据源语言自动选择',
      },
    },
    required: ['text'],
  },
  command: {
    pattern: 'translate <text:rest>',
    alias: ['翻译', 'fy'],
    usage: ['翻译文本'],
    examples: ['/translate Hello World', '/翻译 你好世界'],
  },
  execute: async (args) => {
    const { text, from = 'auto', to } = args;
    
    // 简单的中英检测
    const isChinese = /[\u4e00-\u9fa5]/.test(text);
    const targetLang = to || (isChinese ? 'en' : 'zh');
    
    // 模拟翻译（实际项目中应调用翻译 API）
    logger.info(`[翻译工具] ${from} -> ${targetLang}: ${text}`);
    
    // 简单模拟翻译结果
    const mockTranslations: Record<string, string> = {
      '你好': 'Hello',
      '世界': 'World',
      '你好世界': 'Hello World',
      'hello': '你好',
      'world': '世界',
      'hello world': '你好世界',
    };
    
    const key = text.toLowerCase();
    const translated = mockTranslations[key] || `[模拟翻译] ${text} -> ${targetLang}`;
    
    return `🌐 翻译结果\n\n原文: ${text}\n译文: ${translated}\n\n⚠️ 这是模拟翻译，实际使用请配置翻译 API`;
  },
});

plugin.addTool(translateTool);

// ============================================================================
// 示例 3: 纯 AI 工具（不生成命令）
// ============================================================================

const systemInfoTool = defineTool<{ type?: string }>({
  name: 'get_system_info',
  description: '获取系统信息，包括时间、内存使用等。这是一个仅供 AI 使用的工具。',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: '信息类型: time(时间), memory(内存), all(全部)',
      },
    },
  },
  // 不生成命令
  command: false,
  // 标记为隐藏，不在帮助中显示
  hidden: true,
  execute: async (args) => {
    const { type = 'all' } = args;
    const info: Record<string, any> = {};
    
    if (type === 'time' || type === 'all') {
      info.time = {
        current: new Date().toLocaleString('zh-CN'),
        timestamp: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    
    if (type === 'memory' || type === 'all') {
      const mem = process.memoryUsage();
      info.memory = {
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
        rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
      };
    }
    
    if (type === 'all') {
      info.system = {
        platform: process.platform,
        nodeVersion: process.version,
        uptime: `${Math.round(process.uptime())} 秒`,
      };
    }
    
    return info;
  },
});

// 仅注册工具，不生成命令
plugin.addTool(systemInfoTool, false /* generateCommand: 不为该工具创建聊天命令，仅供 AI 调用 */);

// ============================================================================
// 示例 4: 传统命令 -> 自动转为 AI 工具
// ============================================================================

// 这是一个传统命令定义，会被 ToolService 自动转换为 Tool
// AI 可以直接调用这个命令的功能
addCommand(
  new MessageCommand('dice [count:number] [faces:number]')
    .desc('掷骰子', '可指定数量和面数')
    .usage('掷骰子，可指定数量和面数')
    .examples('/dice 2 6  (掷2个6面骰子)')
    .action((_, { params }) => {
      const count = params.count ?? 1;
      const faces = params.faces ?? 6;
      
      const results: number[] = [];
      for (let i = 0; i < Math.min(count, 10); i++) {
        results.push(Math.floor(Math.random() * faces) + 1);
      }
      
      const total = results.reduce((a, b) => a + b, 0);
      
      return `🎲 ${count}d${faces}: [${results.join(', ')}] = ${total}`;
    })
);


// ============================================================================
// 示例 5: 带权限控制的工具
// ============================================================================

const adminTool = defineTool<{ action: string }>({
  name: 'admin_action',
  description: '管理员操作（需要管理员权限）',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型: status(状态), reload(重载)',
      },
    },
    required: ['action'],
  },
  // 需要管理员权限
  permissions: ['admin'],
  command: {
    pattern: 'admin <action>',
    usage: ['管理员操作'],
  },
  execute: async (args, context) => {
    const { action } = args;
    
    // 权限检查会由系统自动处理
    // 这里只需要实现业务逻辑
    
    switch (action) {
      case 'status':
        return `✅ 系统状态正常\n运行时间: ${Math.round(process.uptime())} 秒`;
      case 'reload':
        return '🔄 配置已重载（模拟）';
      default:
        return `❌ 未知操作: ${action}`;
    }
  },
});

plugin.addTool(adminTool);

// ============================================================================
// 示例 6: 带标签的工具（用于分类）
// ============================================================================

const reminderTool: Tool = {
  name: 'set_reminder',
  description: '设置提醒，到时间后会通知你',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: '提醒内容',
      },
      minutes: {
        type: 'number',
        description: '多少分钟后提醒',
      },
    },
    required: ['message', 'minutes'],
  },
  // 标签用于分类和筛选
  tags: ['utility', 'reminder', 'notification'],
  command: {
    pattern: 'remind <minutes:number> <message:rest>',
    alias: ['提醒', 'reminder'],
    usage: ['设置定时提醒'],
    examples: ['/remind 5 记得喝水', '/提醒 30 开会'],
  },
  execute: async (args, context) => {
    const { message, minutes } = args;
    
    if (minutes <= 0 || minutes > 1440) {
      return '❌ 提醒时间需在 1-1440 分钟之间';
    }
    
    // 实际项目中应该使用 cron 服务
    logger.info(`[提醒工具] 设置提醒: ${minutes}分钟后 - ${message}`);
    
    // 模拟设置提醒
    const targetTime = new Date(Date.now() + minutes * 60 * 1000);
    
    return `⏰ 提醒已设置\n\n` +
      `内容: ${message}\n` +
      `时间: ${targetTime.toLocaleString('zh-CN')}\n` +
      `(${minutes} 分钟后)`;
  },
};

plugin.addTool(reminderTool as Tool);

// ============================================================================
// 打印已注册的工具信息
// ============================================================================

logger.info('[工具示例] 已注册 6 个工具: calculator, translate, get_system_info, dice, admin_action, set_reminder');

