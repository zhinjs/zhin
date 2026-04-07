/**
 * @zhin.js/plugin-60s
 *
 * 60s API 聚合插件 —— 基于 https://github.com/vikiboss/60s
 *
 * 提供多种实用 API 功能，每个功能通过 tools/*.tool.md 文件定义：
 *   - 聊天命令（/60s, /天气 北京, /微博 …）
 *   - AI 工具（Agent 可通过关键词自动匹配并调用）
 *
 * 功能列表：
 *   60s新闻 · 天气 · 微博热搜 · 知乎热榜 · 抖音热搜 · 头条热搜
 *   一言 · 摸鱼日历 · IP查询 · Bing壁纸 · 金价 · 油价
 *   汇率 · 翻译 · 历史上的今天 · KFC文案 · 段子
 *
 * 所有工具定义在 tools/ 目录下，框架自动发现注册。
 *
 * 配置方式（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   60s:
 *     apiBase: https://60s.viki.moe
 * ```
 */
import { usePlugin } from 'zhin.js';

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

// 将 API 地址写入环境变量，供 tool handler 使用
process.env.ZHIN_60S_API = config.apiBase || 'https://60s.viki.moe';

