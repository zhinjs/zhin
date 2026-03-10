/**
 * AI 工作流示例
 * 
 * 演示 AI Agent 如何组合多个工具完成复杂任务
 * 
 * 场景：用户询问 "帮我查一下今天适合出门吗"
 * AI Agent 会自动：
 * 1. 调用天气工具获取天气
 * 2. 调用时间工具获取当前时间
 * 3. 综合分析给出建议
 */
import { usePlugin, defineTool } from 'zhin.js';

const plugin = usePlugin();
const { logger } = plugin;

// ============================================================================
// 知识库工具 - AI 可以查询预定义的知识
// ============================================================================

interface KnowledgeEntry {
  question: string;
  answer: string;
  keywords: string[];
}

const knowledgeBase: KnowledgeEntry[] = [
  {
    question: '什么是 Zhin?',
    answer: 'Zhin 是一个现代化的 TypeScript 聊天机器人框架，支持多平台、插件系统、AI 集成等功能。',
    keywords: ['zhin', '框架', '机器人'],
  },
  {
    question: '如何创建插件?',
    answer: '使用 `usePlugin()` 获取插件实例，然后可以注册命令、工具、中间件等。详见文档。',
    keywords: ['插件', '创建', 'plugin'],
  },
  {
    question: '支持哪些平台?',
    answer: 'Zhin 支持 QQ、Kook、Discord、Telegram、Slack、钉钉、飞书等多个平台。',
    keywords: ['平台', '支持', 'adapter'],
  },
];

const knowledgeTool = defineTool<{ query: string }>({
  name: 'search_knowledge',
  description: '搜索 Zhin 框架相关的知识库，获取使用帮助和文档信息',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词或问题',
      },
    },
    required: ['query'],
  },
  tags: ['knowledge', 'help', 'documentation'],
  command: {
    pattern: 'faq <query:rest>',
    alias: ['知识库', 'help'],
    usage: ['搜索知识库'],
  },
  execute: async (args) => {
    const { query } = args;
    const queryLower = query.toLowerCase();
    
    // 简单的关键词匹配
    const matches = knowledgeBase.filter(entry => 
      entry.keywords.some(kw => queryLower.includes(kw)) ||
      entry.question.toLowerCase().includes(queryLower)
    );
    
    if (matches.length === 0) {
      return `❓ 未找到与 "${query}" 相关的内容\n\n可用主题: Zhin框架、创建插件、支持平台`;
    }
    
    const results = matches.map((m, i) => 
      `${i + 1}. **${m.question}**\n   ${m.answer}`
    ).join('\n\n');
    
    return `📚 知识库搜索结果\n\n${results}`;
  },
});

plugin.addTool(knowledgeTool);

// ============================================================================
// 笔记工具 - AI 可以帮用户记录和查询笔记
// ============================================================================

// 简单的内存存储（实际项目应使用数据库）
const notes = new Map<string, { content: string; createdAt: Date }>();

const saveNoteTool = defineTool<{ title: string; content: string }>({
  name: 'save_note',
  description: '保存一条笔记，可以稍后查询',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '笔记标题',
      },
      content: {
        type: 'string',
        description: '笔记内容',
      },
    },
    required: ['title', 'content'],
  },
  tags: ['note', 'utility'],
  command: {
    pattern: 'note add <title> <content:rest>',
    alias: ['记笔记'],
    usage: ['保存笔记'],
  },
  execute: async (args) => {
    const { title, content } = args;
    notes.set(title, { content, createdAt: new Date() });
    logger.info(`[笔记工具] 保存笔记: ${title}`);
    return `📝 笔记已保存\n\n标题: ${title}\n内容: ${content}`;
  },
});

const getNoteTool = defineTool<{ title?: string }>({
  name: 'get_note',
  description: '查询已保存的笔记',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '笔记标题，不填则列出所有笔记',
      },
    },
  },
  tags: ['note', 'utility'],
  command: {
    pattern: 'note [title]',
    alias: ['查笔记'],
    usage: ['查询笔记'],
  },
  execute: async (args) => {
    const { title } = args;
    
    if (title) {
      const note = notes.get(title);
      if (!note) {
        return `❌ 未找到笔记: ${title}`;
      }
      return `📝 ${title}\n\n${note.content}\n\n创建于: ${note.createdAt.toLocaleString('zh-CN')}`;
    }
    
    if (notes.size === 0) {
      return '📝 还没有任何笔记';
    }
    
    const list = Array.from(notes.entries())
      .map(([t, n]) => `- ${t} (${n.createdAt.toLocaleDateString('zh-CN')})`)
      .join('\n');
    
    return `📝 笔记列表 (${notes.size}条)\n\n${list}`;
  },
});

plugin.addTool(saveNoteTool);
plugin.addTool(getNoteTool);

// ============================================================================
// 代码执行工具 - AI 可以执行简单的 JavaScript 代码
// ============================================================================

const runCodeTool = defineTool<{ code: string }>({
  name: 'run_javascript',
  description: '执行 JavaScript 代码并返回结果。仅支持简单的表达式和计算。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript 代码（单行表达式）',
      },
    },
    required: ['code'],
  },
  tags: ['code', 'utility'],
  // 不生成命令，仅供 AI 使用（安全考虑）
  command: false,
  hidden: true,
  execute: async (args) => {
    const { code } = args;
    
    // 限制代码长度
    if (code.length > 500) {
      return { error: '代码过长' };
    }
    
    try {
      // 使用框架的安全沙箱执行（vm.runInNewContext + 原型链隔离 + 表达式验证）
      const { execute, isExpressionSafe } = await import('@zhin.js/kernel');
      if (!isExpressionSafe(code)) {
        return { error: '代码包含不允许的操作' };
      }
      const result = execute(`return ${code}`, {});
      
      return {
        success: true,
        code,
        result: typeof result === 'object' ? JSON.stringify(result) : String(result),
        type: typeof result,
      };
    } catch (error) {
      return {
        success: false,
        code,
        error: error instanceof Error ? error.message : '执行失败',
      };
    }
  },
});

plugin.addTool(runCodeTool, false);

// ============================================================================
// 综合示例：出行建议工具
// ============================================================================

const travelAdviceTool = defineTool<{ destination?: string }>({
  name: 'travel_advice',
  description: '获取出行建议，会综合考虑天气、时间等因素',
  parameters: {
    type: 'object',
    properties: {
      destination: {
        type: 'string',
        description: '目的地城市',
      },
    },
  },
  tags: ['travel', 'advice'],
  command: {
    pattern: 'travel [destination]',
    alias: ['出行建议', '能出门吗'],
    usage: ['获取出行建议'],
    examples: ['/travel 北京', '/出行建议'],
  },
  execute: async (args, context) => {
    const { destination = '本地' } = args;
    
    // 获取当前时间
    const now = new Date();
    const hour = now.getHours();
    const weekday = now.getDay();
    
    // 模拟天气数据
    const weathers = ['晴朗', '多云', '阴天', '小雨', '大雨'];
    const weather = weathers[Math.floor(Math.random() * 3)]; // 偏向好天气
    const temp = 15 + Math.floor(Math.random() * 15);
    
    // 生成建议
    const factors: string[] = [];
    let score = 80;
    
    // 时间因素
    if (hour >= 6 && hour <= 18) {
      factors.push('✅ 当前是白天，适合外出');
    } else {
      factors.push('⚠️ 当前是夜间，请注意安全');
      score -= 10;
    }
    
    // 天气因素
    if (weather === '晴朗' || weather === '多云') {
      factors.push(`✅ 天气${weather}，温度${temp}°C`);
    } else if (weather === '阴天') {
      factors.push(`⚠️ 天气${weather}，建议带伞`);
      score -= 5;
    } else {
      factors.push(`❌ 天气${weather}，建议推迟出行`);
      score -= 30;
    }
    
    // 周末因素
    if (weekday === 0 || weekday === 6) {
      factors.push('ℹ️ 今天是周末，景点可能拥挤');
    }
    
    // 综合建议
    let advice: string;
    if (score >= 70) {
      advice = '🟢 适合出行！';
    } else if (score >= 50) {
      advice = '🟡 可以出行，但请做好准备';
    } else {
      advice = '🔴 建议推迟出行';
    }
    
    return [
      `🚗 出行建议 - ${destination}`,
      ``,
      `📊 综合评分: ${score}/100`,
      `${advice}`,
      ``,
      `📋 分析因素:`,
      ...factors.map(f => `  ${f}`),
      ``,
      `⏰ 查询时间: ${now.toLocaleString('zh-CN')}`,
    ].join('\n');
  },
});

plugin.addTool(travelAdviceTool);

// ============================================================================
// 日志
// ============================================================================

logger.info('[AI 工作流示例] 已注册 5 个工具: search_knowledge, save_note, get_note, run_javascript, travel_advice');

