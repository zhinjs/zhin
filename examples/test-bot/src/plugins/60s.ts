/**
 * 60s API 聚合插件
 * 
 * 基于 https://github.com/vikiboss/60s 项目
 * 提供多种实用 API 功能：
 * - 60秒新闻（每日60秒读懂世界）
 * - 天气查询
 * - 微博热搜
 * - 知乎热榜
 * - 抖音热搜
 * - 头条热搜
 * - 一言/每日一句
 * - 摸鱼日历
 * - IP 查询
 * - Bing 每日图片
 * 
 * 配置方式：
 * ```yaml
 * plugins:
 *   60s:
 *     apiBase: https://60s.viki.moe  # 可选，默认官方地址
 * ```
 */
import { usePlugin, defineTool } from 'zhin.js';

const plugin = usePlugin();
const { logger } = plugin;

// 配置
interface Config {
  apiBase?: string;
}

const config: Config = {
  apiBase: 'https://60s.viki.moe',
  ...(plugin as any).config,
};

const API_BASE = config.apiBase || 'https://60s.viki.moe';

logger.info(`[60s] API 地址: ${API_BASE}`);

/**
 * 通用 API 请求函数
 */
async function fetchApi<T = any>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}/v2${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  
  logger.debug(`[60s] 请求: ${url.toString()}`);
  
  const res = await fetch(url.toString());
  const data = await res.json() as any;
  
  // 处理错误响应
  if (data.error) {
    throw new Error(data.error);
  }
  
  if (data.code !== undefined && data.code !== 200 && data.code !== 0) {
    throw new Error(data.message || data.msg || `API 错误: ${data.code}`);
  }
  
  return data.data ?? data;
}

/**
 * 格式化列表
 */
function formatList(items: any[], limit = 10): string {
  return items
    .slice(0, limit)
    .map((item, i) => {
      const title = item.title || item.name || item.word || item;
      const hot = item.hot ? ` 🔥${item.hot}` : '';
      return `${i + 1}. ${title}${hot}`;
    })
    .join('\n');
}

// ==================== 工具定义 ====================

/**
 * 60秒新闻 - 每日60秒读懂世界
 */
const newsTool = defineTool({
  name: '60s_news',
  description: '获取每日60秒新闻，快速了解今日要闻',
  parameters: {
    type: 'object',
    properties: {},
  },
  command: {
    pattern: '60s',
    alias: ['新闻', '今日新闻', '60秒'],
    usage: ['获取今日60秒新闻'],
    examples: ['/60s'],
  },
  execute: async () => {
    const data = await fetchApi<any>('/60s');
    
    const lines = [`📰 今日60秒新闻 (${data.date || ''})`, ''];
    
    if (data.news && Array.isArray(data.news)) {
      lines.push(...data.news.map((item: string, i: number) => `${i + 1}. ${item}`));
    }
    
    if (data.tip) {
      lines.push('', `💡 ${data.tip}`);
    }
    
    return lines.join('\n');
  },
});

/**
 * 天气查询
 */
const weatherTool = defineTool<{ city: string }>({
  name: 'weather',
  description: '查询指定城市的当前天气信息',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，如"成都"、"北京"',
      },
    },
    required: ['city'],
  },
  command: {
    pattern: 'weather <city>',
    alias: ['天气', 'tq'],
    usage: ['查询城市天气'],
    examples: ['/weather 成都', '/天气 北京'],
  },
  execute: async (args) => {
    const data = await fetchApi<any>('/weather', { query: args.city });
    
    const w = data.weather;
    const aq = data.air_quality;
    const loc = data.location;
    
    const lines = [
      `🌤️ ${loc?.name || args.city} 天气`,
      '',
      `🌡️ 温度: ${w.temperature}°C`,
      `☁️ 天气: ${w.condition}`,
      `💧 湿度: ${w.humidity}%`,
      `💨 风: ${w.wind_direction} ${w.wind_power}`,
    ];
    
    if (aq) {
      lines.push(`🌬️ 空气: ${aq.quality} (AQI ${aq.aqi})`);
    }
    
    return lines.join('\n');
  },
});

/**
 * 微博热搜
 */
const weiboTool = defineTool<{ limit?: number }>({
  name: 'weibo_hot',
  description: '获取微博热搜榜',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: '返回条数，默认10条',
      },
    },
  },
  command: {
    pattern: 'weibo [limit:number]',
    alias: ['微博热搜', 'wb'],
    usage: ['获取微博热搜'],
    examples: ['/weibo', '/weibo 20'],
  },
  execute: async (args) => {
    const data = await fetchApi<any[]>('/weibo');
    const limit = args.limit || 10;
    
    const lines = ['🔥 微博热搜', ''];
    lines.push(formatList(data, limit));
    
    return lines.join('\n');
  },
});

/**
 * 知乎热榜
 */
const zhihuTool = defineTool<{ limit?: number }>({
  name: 'zhihu_hot',
  description: '获取知乎热榜',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: '返回条数，默认10条',
      },
    },
  },
  command: {
    pattern: 'zhihu [limit:number]',
    alias: ['知乎热榜', 'zh'],
    usage: ['获取知乎热榜'],
    examples: ['/zhihu', '/zhihu 20'],
  },
  execute: async (args) => {
    const data = await fetchApi<any[]>('/zhihu');
    const limit = args.limit || 10;
    
    const lines = ['🔥 知乎热榜', ''];
    lines.push(formatList(data, limit));
    
    return lines.join('\n');
  },
});

/**
 * 抖音热搜
 */
const douyinTool = defineTool<{ limit?: number }>({
  name: 'douyin_hot',
  description: '获取抖音热搜榜',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: '返回条数，默认10条',
      },
    },
  },
  command: {
    pattern: 'douyin [limit:number]',
    alias: ['抖音热搜', 'dy'],
    usage: ['获取抖音热搜'],
    examples: ['/douyin', '/douyin 20'],
  },
  execute: async (args) => {
    const data = await fetchApi<any[]>('/douyin');
    const limit = args.limit || 10;
    
    const lines = ['🔥 抖音热搜', ''];
    lines.push(formatList(data, limit));
    
    return lines.join('\n');
  },
});

/**
 * 头条热搜
 */
const toutiaoTool = defineTool<{ limit?: number }>({
  name: 'toutiao_hot',
  description: '获取今日头条热搜榜',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: '返回条数，默认10条',
      },
    },
  },
  command: {
    pattern: 'toutiao [limit:number]',
    alias: ['头条热搜', 'tt'],
    usage: ['获取头条热搜'],
    examples: ['/toutiao', '/tt 20'],
  },
  execute: async (args) => {
    const data = await fetchApi<any[]>('/toutiao');
    const limit = args.limit || 10;
    
    const lines = ['🔥 头条热搜', ''];
    lines.push(formatList(data, limit));
    
    return lines.join('\n');
  },
});

/**
 * 一言
 */
const hitokotoTool = defineTool<{ type?: string }>({
  name: 'hitokoto',
  description: '获取一言/每日一句，随机返回一条语句',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: '类型：a=动画, b=漫画, c=游戏, d=文学, e=原创, f=网络, g=其他, h=影视, i=诗词, j=网易云, k=哲学, l=抖机灵',
      },
    },
  },
  command: {
    pattern: 'hitokoto [type]',
    alias: ['一言', '每日一句', 'yy'],
    usage: ['获取随机一言'],
    examples: ['/hitokoto', '/一言 i'],
  },
  execute: async (args) => {
    const params: Record<string, string> | undefined = args.type ? { c: args.type } : undefined;
    const data = await fetchApi<any>('/hitokoto', params);
    
    const lines = ['💬 一言', ''];
    lines.push(`「${data.hitokoto || data.content || data}」`);
    
    if (data.from || data.source) {
      const author = data.from_who || data.author || '';
      const source = data.from || data.source || '';
      lines.push(`——${author}${source ? `《${source}》` : ''}`);
    }
    
    return lines.join('\n');
  },
});

/**
 * 摸鱼日历
 */
const moyuTool = defineTool({
  name: 'moyu',
  description: '获取摸鱼日历，查看今天适不适合摸鱼',
  parameters: {
    type: 'object',
    properties: {},
  },
  command: {
    pattern: 'moyu',
    alias: ['摸鱼', '摸鱼日历'],
    usage: ['获取摸鱼日历'],
    examples: ['/moyu'],
  },
  execute: async () => {
    const data = await fetchApi<any>('/moyu');
    
    // 返回的可能是图片 URL
    if (typeof data === 'string') {
      if (data.startsWith('http')) {
        return `🐟 摸鱼日历\n\n${data}`;
      }
      return `🐟 摸鱼日历\n\n${data}`;
    }
    
    if (data.url || data.image) {
      return `🐟 摸鱼日历\n\n${data.url || data.image}`;
    }
    
    return `🐟 摸鱼日历\n\n${JSON.stringify(data)}`;
  },
});

/**
 * IP 查询
 */
const ipTool = defineTool<{ ip?: string }>({
  name: 'ip_query',
  description: '查询 IP 地址的地理位置信息',
  parameters: {
    type: 'object',
    properties: {
      ip: {
        type: 'string',
        description: 'IP 地址，不填则查询当前 IP',
      },
    },
  },
  command: {
    pattern: 'ip [ip]',
    alias: ['IP查询'],
    usage: ['查询 IP 地址信息'],
    examples: ['/ip', '/ip 8.8.8.8'],
  },
  execute: async (args) => {
    const params: Record<string, string> | undefined = args.ip ? { ip: args.ip } : undefined;
    const data = await fetchApi<any>('/ip', params);
    
    const lines = ['🌐 IP 查询', ''];
    lines.push(`IP: ${data.ip || args.ip || '当前 IP'}`);
    
    if (data.country || data.region || data.city) {
      lines.push(`位置: ${data.country || ''}${data.region || ''}${data.city || ''}`);
    }
    if (data.isp) {
      lines.push(`运营商: ${data.isp}`);
    }
    if (data.location) {
      lines.push(`位置: ${data.location}`);
    }
    
    return lines.join('\n');
  },
});

/**
 * Bing 每日图片
 */
const bingTool = defineTool({
  name: 'bing_image',
  description: '获取 Bing 每日壁纸图片',
  parameters: {
    type: 'object',
    properties: {},
  },
  command: {
    pattern: 'bing',
    alias: ['必应', '每日壁纸'],
    usage: ['获取 Bing 每日壁纸'],
    examples: ['/bing'],
  },
  execute: async () => {
    const data = await fetchApi<any>('/bing');
    
    const lines = ['🖼️ Bing 每日壁纸', ''];
    
    if (data.title) {
      lines.push(`📌 ${data.title}`);
    }
    if (data.copyright) {
      lines.push(`📝 ${data.copyright}`);
    }
    if (data.url || data.image) {
      lines.push('', data.url || data.image);
    }
    
    return lines.join('\n');
  },
});

/**
 * 金价查询
 */
const goldPriceTool = defineTool({
  name: 'gold_price',
  description: '查询今日黄金价格',
  parameters: {
    type: 'object',
    properties: {},
  },
  command: {
    pattern: 'gold',
    alias: ['金价', '黄金价格', 'jj'],
    usage: ['查询今日金价'],
    examples: ['/gold', '/金价'],
  },
  execute: async () => {
    const data = await fetchApi<any>('/gold-price');
    
    const lines = ['💰 今日金价', ''];
    
    if (Array.isArray(data)) {
      data.slice(0, 10).forEach((item: any) => {
        const name = item.name || item.title || '黄金';
        const price = item.price || item.value;
        const change = item.change || item.diff;
        const changeIcon = change?.includes('-') ? '📉' : '📈';
        lines.push(`${name}: ¥${price} ${change ? `${changeIcon}${change}` : ''}`);
      });
    } else if (data.price) {
      lines.push(`当前金价: ¥${data.price}/克`);
      if (data.change) lines.push(`涨跌: ${data.change}`);
    } else {
      lines.push(JSON.stringify(data));
    }
    
    return lines.join('\n');
  },
});

/**
 * 油价查询
 */
const fuelPriceTool = defineTool<{ province?: string }>({
  name: 'fuel_price',
  description: '查询今日油价',
  parameters: {
    type: 'object',
    properties: {
      province: {
        type: 'string',
        description: '省份名称，如"四川"、"北京"',
      },
    },
  },
  command: {
    pattern: 'fuel [province]',
    alias: ['油价', 'yj'],
    usage: ['查询今日油价'],
    examples: ['/fuel', '/油价 四川'],
  },
  execute: async (args) => {
    const params: Record<string, string> | undefined = args.province ? { province: args.province } : undefined;
    const data = await fetchApi<any>('/fuel-price', params);
    
    const lines = ['⛽ 今日油价', ''];
    
    if (data.province) {
      lines.push(`📍 ${data.province}`);
    }
    
    if (data['92'] || data['95'] || data['98']) {
      if (data['92']) lines.push(`92号汽油: ¥${data['92']}/升`);
      if (data['95']) lines.push(`95号汽油: ¥${data['95']}/升`);
      if (data['98']) lines.push(`98号汽油: ¥${data['98']}/升`);
      if (data['0']) lines.push(`0号柴油: ¥${data['0']}/升`);
    } else if (Array.isArray(data)) {
      data.slice(0, 5).forEach((item: any) => {
        lines.push(`${item.name || item.province}: 92号¥${item['92'] || item.price92}`);
      });
    } else {
      lines.push(JSON.stringify(data));
    }
    
    return lines.join('\n');
  },
});

/**
 * 汇率查询
 */
const exchangeRateTool = defineTool<{ from?: string; to?: string }>({
  name: 'exchange_rate',
  description: '查询货币汇率',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: '源货币，如 USD, EUR, JPY',
      },
      to: {
        type: 'string',
        description: '目标货币，如 CNY',
      },
    },
  },
  command: {
    pattern: 'exchange [from] [to]',
    alias: ['汇率', 'hl'],
    usage: ['查询汇率'],
    examples: ['/exchange USD CNY', '/汇率'],
  },
  execute: async (args) => {
    const params: Record<string, string> = {};
    if (args.from) params.from = args.from.toUpperCase();
    if (args.to) params.to = args.to.toUpperCase();
    
    const data = await fetchApi<any>('/exchange-rate', Object.keys(params).length ? params : undefined);
    
    const lines = ['💱 汇率查询', ''];
    
    if (Array.isArray(data)) {
      data.slice(0, 10).forEach((item: any) => {
        const name = item.name || item.currency;
        const rate = item.rate || item.value;
        lines.push(`${name}: ${rate}`);
      });
    } else if (data.rate) {
      lines.push(`${args.from || 'USD'} → ${args.to || 'CNY'}: ${data.rate}`);
    } else {
      lines.push(JSON.stringify(data));
    }
    
    return lines.join('\n');
  },
});

/**
 * 翻译
 */
const translateTool = defineTool<{ text: string; to?: string }>({
  name: 'translate_60s',
  description: '翻译文本',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '要翻译的文本',
      },
      to: {
        type: 'string',
        description: '目标语言，如 en, zh, ja',
      },
    },
    required: ['text'],
  },
  command: {
    pattern: 'fanyi <text> [to]',
    alias: ['翻译', 'fy'],
    usage: ['翻译文本'],
    examples: ['/fanyi hello', '/翻译 你好 en'],
  },
  execute: async (args) => {
    const params: Record<string, string> = { text: args.text };
    if (args.to) params.to = args.to;
    
    const data = await fetchApi<any>('/fanyi', params);
    
    const lines = ['🌐 翻译结果', ''];
    lines.push(`原文: ${args.text}`);
    lines.push(`译文: ${data.result || data.translation || data.text || data}`);
    
    return lines.join('\n');
  },
});

/**
 * 历史上的今天
 */
const historyTodayTool = defineTool({
  name: 'history_today',
  description: '查看历史上的今天发生了什么',
  parameters: {
    type: 'object',
    properties: {},
  },
  command: {
    pattern: 'history',
    alias: ['历史上的今天', '历史'],
    usage: ['查看历史上的今天'],
    examples: ['/history'],
  },
  execute: async () => {
    const data = await fetchApi<any>('/today-in-history');
    
    const today = new Date();
    const lines = [`📅 历史上的今天 (${today.getMonth() + 1}月${today.getDate()}日)`, ''];
    
    if (Array.isArray(data)) {
      data.slice(0, 10).forEach((item: any, i: number) => {
        const year = item.year || '';
        const title = item.title || item.event || item.content || item;
        lines.push(`${i + 1}. ${year ? `[${year}] ` : ''}${title}`);
      });
    } else {
      lines.push(JSON.stringify(data));
    }
    
    return lines.join('\n');
  },
});

/**
 * KFC 疯狂星期四文案
 */
const kfcTool = defineTool({
  name: 'kfc',
  description: '获取 KFC 疯狂星期四文案',
  parameters: {
    type: 'object',
    properties: {},
  },
  command: {
    pattern: 'kfc',
    alias: ['疯狂星期四', 'v50'],
    usage: ['获取 KFC 文案'],
    examples: ['/kfc'],
  },
  execute: async () => {
    const data = await fetchApi<any>('/kfc');
    return `🍗 疯狂星期四\n\n${data.content || data.text || data}`;
  },
});

/**
 * 段子
 */
const duanziTool = defineTool({
  name: 'duanzi',
  description: '获取一个段子',
  parameters: {
    type: 'object',
    properties: {},
  },
  command: {
    pattern: 'duanzi',
    alias: ['段子', 'joke'],
    usage: ['获取段子'],
    examples: ['/duanzi'],
  },
  execute: async () => {
    const data = await fetchApi<any>('/duanzi');
    return `😂 段子\n\n${data.content || data.text || data}`;
  },
});

// ==================== 注册所有工具 ====================

const allTools = [
  newsTool,
  weatherTool,
  weiboTool,
  zhihuTool,
  douyinTool,
  toutiaoTool,
  hitokotoTool,
  moyuTool,
  ipTool,
  bingTool,
  goldPriceTool,
  fuelPriceTool,
  exchangeRateTool,
  translateTool,
  historyTodayTool,
  kfcTool,
  duanziTool,
];

// 注册所有工具
allTools.forEach(tool => plugin.addTool(tool));

logger.info(`[60s] 已注册 ${allTools.length} 个工具: ${allTools.map(t => t.name).join(', ')}`);
