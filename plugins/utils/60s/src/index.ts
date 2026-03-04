/**
 * @zhin.js/plugin-60s
 *
 * 60s API 聚合插件 —— 基于 https://github.com/vikiboss/60s
 *
 * 提供多种实用 API 功能，每个功能同时注册为：
 *   - 聊天命令（/60s, /天气 北京, /微博 …）
 *   - AI 工具（Agent 可通过关键词自动匹配并调用）
 *
 * 功能列表：
 *   60s新闻 · 天气 · 微博热搜 · 知乎热榜 · 抖音热搜 · 头条热搜
 *   一言 · 摸鱼日历 · IP查询 · Bing壁纸 · 金价 · 油价
 *   汇率 · 翻译 · 历史上的今天 · KFC文案 · 段子
 *
 * 配置方式（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   60s:
 *     apiBase: https://60s.viki.moe
 * ```
 */
import { usePlugin, ZhinTool } from 'zhin.js';

const plugin = usePlugin();
const { logger, root } = plugin;

// ─── 配置 ────────────────────────────────────────────────────────────────────

interface Config {
  apiBase?: string;
}

const configService = root.inject('config');
const appConfig = configService?.get<{ '60s'?: Config }>('zhin.config.yml') || {};
const config: Config = {
  apiBase: 'https://60s.viki.moe',
  ...appConfig['60s'],
};

const API_BASE = config.apiBase || 'https://60s.viki.moe';

logger.debug(`[60s] API 地址: ${API_BASE}`);

// ─── 通用请求 ────────────────────────────────────────────────────────────────

async function fetchApi<T = any>(
  endpoint: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${API_BASE}/v2${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  logger.debug(`[60s] 请求: ${url.toString()}`);

  const res = await fetch(url.toString());
  const data = (await res.json()) as any;

  if (data.error) throw new Error(data.error);
  if (data.code !== undefined && data.code !== 200 && data.code !== 0) {
    throw new Error(data.message || data.msg || `API 错误: ${data.code}`);
  }

  return data.data ?? data;
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════════
// 工具定义（ZhinTool 链式风格 — 同时注册命令 + AI 工具）
// ═══════════════════════════════════════════════════════════════════════════════

// ── 60 秒新闻 ────────────────────────────────────────────────────────────────
const newsTool = new ZhinTool('60s_news')
  .desc('获取每日60秒新闻，快速了解今日要闻')
  .tag('新闻', '资讯', '60s')
  .keyword('60s', '新闻', '今日新闻', '60秒', '每日新闻', '读懂世界')
  .alias('新闻', '今日新闻', '60秒')
  .usage('获取今日60秒新闻')
  .examples('/60s')
  .execute(async () => {
    const data = await fetchApi<any>('/60s');
    const lines = [`📰 今日60秒新闻 (${data.date || ''})`, ''];
    if (data.news && Array.isArray(data.news)) {
      lines.push(...data.news.map((n: string, i: number) => `${i + 1}. ${n}`));
    }
    if (data.tip) lines.push('', `💡 ${data.tip}`);
    return lines.join('\n');
  });

// ── 天气 ──────────────────────────────────────────────────────────────────────
const weatherTool = new ZhinTool('weather')
  .desc('查询指定城市的当前天气信息')
  .tag('天气', '生活', '查询')
  .keyword('天气', '气温', '温度', '下雨', '晴天', '阴天', 'weather')
  .alias('天气', 'tq')
  .usage('查询城市天气')
  .examples('/weather 成都', '/天气 北京')
  .param('city', { type: 'string', description: '城市名称，如"成都"、"北京"' }, true)
  .execute(async (args) => {
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
    if (aq) lines.push(`🌬️ 空气: ${aq.quality} (AQI ${aq.aqi})`);
    return lines.join('\n');
  });

// ── 微博热搜 ──────────────────────────────────────────────────────────────────
const weiboTool = new ZhinTool('weibo_hot')
  .desc('获取微博热搜榜')
  .tag('热搜', '社交', '微博')
  .keyword('微博', '热搜', 'weibo', 'wb')
  .alias('微博热搜', 'wb')
  .usage('获取微博热搜')
  .examples('/weibo', '/weibo 20')
  .param('limit', { type: 'number', description: '返回条数，默认10条' })
  .execute(async (args) => {
    const data = await fetchApi<any[]>('/weibo');
    return ['🔥 微博热搜', '', formatList(data, args.limit || 10)].join('\n');
  });

// ── 知乎热榜 ──────────────────────────────────────────────────────────────────
const zhihuTool = new ZhinTool('zhihu_hot')
  .desc('获取知乎热榜')
  .tag('热搜', '社交', '知乎')
  .keyword('知乎', '热榜', 'zhihu', 'zh')
  .alias('知乎热榜', 'zh')
  .usage('获取知乎热榜')
  .examples('/zhihu', '/zhihu 20')
  .param('limit', { type: 'number', description: '返回条数，默认10条' })
  .execute(async (args) => {
    const data = await fetchApi<any[]>('/zhihu');
    return ['🔥 知乎热榜', '', formatList(data, args.limit || 10)].join('\n');
  });

// ── 抖音热搜 ──────────────────────────────────────────────────────────────────
const douyinTool = new ZhinTool('douyin_hot')
  .desc('获取抖音热搜榜')
  .tag('热搜', '短视频', '抖音')
  .keyword('抖音', '热搜', 'douyin', 'dy')
  .alias('抖音热搜', 'dy')
  .usage('获取抖音热搜')
  .examples('/douyin', '/douyin 20')
  .param('limit', { type: 'number', description: '返回条数，默认10条' })
  .execute(async (args) => {
    const data = await fetchApi<any[]>('/douyin');
    return ['🔥 抖音热搜', '', formatList(data, args.limit || 10)].join('\n');
  });

// ── 头条热搜 ──────────────────────────────────────────────────────────────────
const toutiaoTool = new ZhinTool('toutiao_hot')
  .desc('获取今日头条热搜榜')
  .tag('热搜', '资讯', '头条')
  .keyword('头条', '今日头条', '热搜', 'toutiao', 'tt')
  .alias('头条热搜', 'tt')
  .usage('获取头条热搜')
  .examples('/toutiao', '/tt 20')
  .param('limit', { type: 'number', description: '返回条数，默认10条' })
  .execute(async (args) => {
    const data = await fetchApi<any[]>('/toutiao');
    return ['🔥 头条热搜', '', formatList(data, args.limit || 10)].join('\n');
  });

// ── 一言 ──────────────────────────────────────────────────────────────────────
const hitokotoTool = new ZhinTool('hitokoto')
  .desc('获取一言/每日一句，随机返回一条语句')
  .tag('语录', '文学', '随机')
  .keyword('一言', '每日一句', '语录', '名言', 'hitokoto')
  .alias('一言', '每日一句', 'yy')
  .usage('获取随机一言')
  .examples('/hitokoto', '/一言 i')
  .param('type', {
    type: 'string',
    description:
      '类型：a=动画, b=漫画, c=游戏, d=文学, e=原创, f=网络, g=其他, h=影视, i=诗词, j=网易云, k=哲学, l=抖机灵',
  })
  .execute(async (args) => {
    const params: Record<string, string> | undefined = args.type
      ? { c: args.type }
      : undefined;
    const data = await fetchApi<any>('/hitokoto', params);
    const lines = ['💬 一言', '', `「${data.hitokoto || data.content || data}」`];
    if (data.from || data.source) {
      const author = data.from_who || data.author || '';
      const source = data.from || data.source || '';
      lines.push(`——${author}${source ? `《${source}》` : ''}`);
    }
    return lines.join('\n');
  });

// ── 摸鱼日历 ──────────────────────────────────────────────────────────────────
const moyuTool = new ZhinTool('moyu')
  .desc('获取摸鱼日历，查看今天适不适合摸鱼')
  .tag('生活', '摸鱼', '日历')
  .keyword('摸鱼', '摸鱼日历', 'moyu')
  .alias('摸鱼', '摸鱼日历')
  .usage('获取摸鱼日历')
  .examples('/moyu')
  .execute(async () => {
    const data = await fetchApi<any>('/moyu');
    if (typeof data === 'string') return `🐟 摸鱼日历\n\n${data}`;
    if (data.url || data.image) return `🐟 摸鱼日历\n\n${data.url || data.image}`;
    return `🐟 摸鱼日历\n\n${JSON.stringify(data)}`;
  });

// ── IP 查询 ───────────────────────────────────────────────────────────────────
const ipTool = new ZhinTool('ip_query')
  .desc('查询 IP 地址的地理位置信息')
  .tag('网络', '查询', 'IP')
  .keyword('ip', 'IP', 'IP查询', 'ip查询')
  .alias('IP查询')
  .usage('查询 IP 地址信息')
  .examples('/ip', '/ip 8.8.8.8')
  .param('ip', { type: 'string', description: 'IP 地址，不填则查询当前 IP' })
  .execute(async (args) => {
    const params: Record<string, string> | undefined = args.ip
      ? { ip: args.ip }
      : undefined;
    const data = await fetchApi<any>('/ip', params);
    const lines = ['🌐 IP 查询', '', `IP: ${data.ip || args.ip || '当前 IP'}`];
    if (data.country || data.region || data.city) {
      lines.push(
        `位置: ${data.country || ''}${data.region || ''}${data.city || ''}`,
      );
    }
    if (data.isp) lines.push(`运营商: ${data.isp}`);
    if (data.location) lines.push(`位置: ${data.location}`);
    return lines.join('\n');
  });

// ── Bing 每日图片 ─────────────────────────────────────────────────────────────
const bingTool = new ZhinTool('bing_image')
  .desc('获取 Bing 每日壁纸图片')
  .tag('图片', '壁纸', 'Bing')
  .keyword('bing', '必应', '壁纸', '每日壁纸')
  .alias('必应', '每日壁纸')
  .usage('获取 Bing 每日壁纸')
  .examples('/bing')
  .execute(async () => {
    const data = await fetchApi<any>('/bing');
    const lines = ['🖼️ Bing 每日壁纸', ''];
    if (data.title) lines.push(`📌 ${data.title}`);
    if (data.copyright) lines.push(`📝 ${data.copyright}`);
    if (data.url || data.image) lines.push('', data.url || data.image);
    return lines.join('\n');
  });

// ── 金价 ──────────────────────────────────────────────────────────────────────
const goldPriceTool = new ZhinTool('gold_price')
  .desc('查询今日黄金价格')
  .tag('金融', '黄金', '价格')
  .keyword('金价', '黄金', '黄金价格', 'gold')
  .alias('金价', '黄金价格', 'jj')
  .usage('查询今日金价')
  .examples('/gold', '/金价')
  .execute(async () => {
    const data = await fetchApi<any>('/gold-price');
    const lines = ['💰 今日金价', ''];
    if (Array.isArray(data)) {
      data.slice(0, 10).forEach((item: any) => {
        const name = item.name || item.title || '黄金';
        const price = item.price || item.value;
        const change = item.change || item.diff;
        const icon = change?.includes('-') ? '📉' : '📈';
        lines.push(`${name}: ¥${price} ${change ? `${icon}${change}` : ''}`);
      });
    } else if (data.price) {
      lines.push(`当前金价: ¥${data.price}/克`);
      if (data.change) lines.push(`涨跌: ${data.change}`);
    } else {
      lines.push(JSON.stringify(data));
    }
    return lines.join('\n');
  });

// ── 油价 ──────────────────────────────────────────────────────────────────────
const fuelPriceTool = new ZhinTool('fuel_price')
  .desc('查询今日油价')
  .tag('生活', '油价', '价格')
  .keyword('油价', '汽油', '柴油', 'fuel')
  .alias('油价', 'yj')
  .usage('查询今日油价')
  .examples('/fuel', '/油价 四川')
  .param('province', { type: 'string', description: '省份名称，如"四川"、"北京"' })
  .execute(async (args) => {
    const params: Record<string, string> | undefined = args.province
      ? { province: args.province }
      : undefined;
    const data = await fetchApi<any>('/fuel-price', params);
    const lines = ['⛽ 今日油价', ''];
    if (data.province) lines.push(`📍 ${data.province}`);
    if (data['92'] || data['95'] || data['98']) {
      if (data['92']) lines.push(`92号汽油: ¥${data['92']}/升`);
      if (data['95']) lines.push(`95号汽油: ¥${data['95']}/升`);
      if (data['98']) lines.push(`98号汽油: ¥${data['98']}/升`);
      if (data['0']) lines.push(`0号柴油: ¥${data['0']}/升`);
    } else if (Array.isArray(data)) {
      data
        .slice(0, 5)
        .forEach((item: any) =>
          lines.push(
            `${item.name || item.province}: 92号¥${item['92'] || item.price92}`,
          ),
        );
    } else {
      lines.push(JSON.stringify(data));
    }
    return lines.join('\n');
  });

// ── 汇率 ──────────────────────────────────────────────────────────────────────
const exchangeRateTool = new ZhinTool('exchange_rate')
  .desc('查询货币汇率')
  .tag('金融', '汇率', '查询')
  .keyword('汇率', '兑换', '外汇', 'exchange', 'rate')
  .alias('汇率', 'hl')
  .usage('查询汇率')
  .examples('/exchange USD CNY', '/汇率')
  .param('from', { type: 'string', description: '源货币，如 USD, EUR, JPY' })
  .param('to', { type: 'string', description: '目标货币，如 CNY' })
  .execute(async (args) => {
    const params: Record<string, string> = {};
    if (args.from) params.from = args.from.toUpperCase();
    if (args.to) params.to = args.to.toUpperCase();
    const data = await fetchApi<any>(
      '/exchange-rate',
      Object.keys(params).length ? params : undefined,
    );
    const lines = ['💱 汇率查询', ''];
    if (Array.isArray(data)) {
      data.slice(0, 10).forEach((item: any) => {
        lines.push(`${item.name || item.currency}: ${item.rate || item.value}`);
      });
    } else if (data.rate) {
      lines.push(`${args.from || 'USD'} → ${args.to || 'CNY'}: ${data.rate}`);
    } else {
      lines.push(JSON.stringify(data));
    }
    return lines.join('\n');
  });

// ── 翻译 ──────────────────────────────────────────────────────────────────────
const translateTool = new ZhinTool('translate_60s')
  .desc('翻译文本')
  .tag('工具', '翻译', '语言')
  .keyword('翻译', '英文', '中文', '日文', 'translate', '译')
  .alias('翻译', 'fy')
  .usage('翻译文本')
  .examples('/fanyi hello', '/翻译 你好 en')
  .param('text', { type: 'string', description: '要翻译的文本' }, true)
  .param('to', { type: 'string', description: '目标语言，如 en, zh, ja' })
  .execute(async (args) => {
    const params: Record<string, string> = { text: args.text };
    if (args.to) params.to = args.to;
    const data = await fetchApi<any>('/fanyi', params);
    return [
      '🌐 翻译结果',
      '',
      `原文: ${args.text}`,
      `译文: ${data.result || data.translation || data.text || data}`,
    ].join('\n');
  });

// ── 历史上的今天 ──────────────────────────────────────────────────────────────
const historyTodayTool = new ZhinTool('history_today')
  .desc('查看历史上的今天发生了什么')
  .tag('历史', '知识', '日历')
  .keyword('历史', '历史上的今天', '今天历史', 'history')
  .alias('历史上的今天', '历史')
  .usage('查看历史上的今天')
  .examples('/history')
  .execute(async () => {
    const data = await fetchApi<any>('/today-in-history');
    const today = new Date();
    const lines = [
      `📅 历史上的今天 (${today.getMonth() + 1}月${today.getDate()}日)`,
      '',
    ];
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
  });

// ── KFC 疯狂星期四 ────────────────────────────────────────────────────────────
const kfcTool = new ZhinTool('kfc')
  .desc('获取 KFC 疯狂星期四文案')
  .tag('娱乐', 'KFC', '文案')
  .keyword('kfc', 'KFC', '疯狂星期四', 'v50', '肯德基')
  .alias('疯狂星期四', 'v50')
  .usage('获取 KFC 文案')
  .examples('/kfc')
  .execute(async () => {
    const data = await fetchApi<any>('/kfc');
    return `🍗 疯狂星期四\n\n${data.content || data.text || data}`;
  });

// ── 段子 ──────────────────────────────────────────────────────────────────────
const duanziTool = new ZhinTool('duanzi')
  .desc('获取一个段子')
  .tag('娱乐', '笑话', '段子')
  .keyword('段子', '笑话', '搞笑', 'joke', 'duanzi')
  .alias('段子', 'joke')
  .usage('获取段子')
  .examples('/duanzi')
  .execute(async () => {
    const data = await fetchApi<any>('/duanzi');
    return `😂 段子\n\n${data.content || data.text || data}`;
  });

// ═══════════════════════════════════════════════════════════════════════════════
// 注册所有工具
// ═══════════════════════════════════════════════════════════════════════════════

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

allTools.forEach((tool) => plugin.addTool(tool.toTool()));

// 声明 Skill 元数据 — 让 AI Agent 知道这个插件的能力
plugin.declareSkill({
  description:
    '60s API 聚合服务：提供新闻、天气、热搜、金价、油价、汇率、翻译、一言、摸鱼日历等 17 种实用查询能力',
  tags: ['新闻', '资讯', '天气', '热搜', '生活', '金融', '娱乐', '工具'],
  keywords: [
    '60s', '新闻', '天气', '微博', '知乎', '抖音', '头条',
    '一言', '摸鱼', '金价', '油价', '汇率', '翻译', '历史',
    'kfc', '段子', '壁纸', 'bing', 'ip',
  ],
});

logger.debug(`[60s] 已注册 ${allTools.length} 个工具`);
