# @zhin.js/plugin-60s

60s API 聚合插件 —— 基于 [60s](https://github.com/vikiboss/60s) 项目，为 Zhin.js 提供 17 种实用 API 工具。

每个功能同时注册为 **聊天命令** 和 **AI 工具**，支持命令触发和 AI Agent 智能调用。

## 安装

```bash
npm install @zhin.js/plugin-60s
# 或
pnpm add @zhin.js/plugin-60s
```

## 配置

在 `zhin.config.yml` 中添加插件：

```yaml
plugins:
  60s:
    apiBase: https://60s.viki.moe  # 可选，默认官方地址
```

## 功能列表

| 命令 | 别名 | 说明 |
|------|------|------|
| `/60s` | 新闻、今日新闻、60秒 | 每日60秒新闻 |
| `/weather <城市>` | 天气、tq | 天气查询 |
| `/weibo [数量]` | 微博热搜、wb | 微博热搜榜 |
| `/zhihu [数量]` | 知乎热榜、zh | 知乎热榜 |
| `/douyin [数量]` | 抖音热搜、dy | 抖音热搜榜 |
| `/toutiao [数量]` | 头条热搜、tt | 头条热搜榜 |
| `/hitokoto [类型]` | 一言、每日一句、yy | 随机一言 |
| `/moyu` | 摸鱼、摸鱼日历 | 摸鱼日历 |
| `/ip [地址]` | IP查询 | IP 地理位置查询 |
| `/bing` | 必应、每日壁纸 | Bing 每日壁纸 |
| `/gold` | 金价、黄金价格、jj | 今日金价 |
| `/fuel [省份]` | 油价、yj | 今日油价 |
| `/exchange [源] [目标]` | 汇率、hl | 货币汇率查询 |
| `/fanyi <文本> [语言]` | 翻译、fy | 文本翻译 |
| `/history` | 历史上的今天、历史 | 历史上的今天 |
| `/kfc` | 疯狂星期四、v50 | KFC 疯狂星期四文案 |
| `/duanzi` | 段子、joke | 随机段子 |

## AI 工具集成

所有工具均标记了 `tags` 和 `keywords`，支持 `@zhin.js/core` 内置 AI 的程序化工具过滤。用户通过自然语言即可触发对应工具，无需记忆命令格式：

- "今天的新闻是什么" → 自动调用 60s 新闻
- "北京天气怎么样" → 自动调用天气查询
- "微博有什么热搜" → 自动调用微博热搜

## API 来源

本插件使用 [60s API](https://60s.viki.moe) 提供的公开接口，感谢 [vikiboss](https://github.com/vikiboss) 的开源项目。

## License

MIT
