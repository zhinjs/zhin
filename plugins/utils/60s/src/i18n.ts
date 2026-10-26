import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "news": {
    "zh-CN": "📰 今日60秒新闻 ({date})",
    "en": "📰 60-second daily news ({date})"
  },
  "weather": {
    "zh-CN": "🌤️ {city} 天气",
    "en": "🌤️ Weather in {city}"
  },
  "temperature": {
    "zh-CN": "🌡️ 温度: {value}°C",
    "en": "🌡️ Temperature: {value}°C"
  },
  "condition": {
    "zh-CN": "☁️ 天气: {value}",
    "en": "☁️ Conditions: {value}"
  },
  "humidity": {
    "zh-CN": "💧 湿度: {value}%",
    "en": "💧 Humidity: {value}%"
  },
  "wind": {
    "zh-CN": "💨 风: {direction} {power}",
    "en": "💨 Wind: {direction} {power}"
  },
  "air": {
    "zh-CN": "🌬️ 空气: {value}",
    "en": "🌬️ Air quality: {value}"
  },
  "weibo": {
    "zh-CN": "🔥 微博热搜",
    "en": "🔥 Weibo trending"
  },
  "zhihu": {
    "zh-CN": "🔥 知乎热榜",
    "en": "🔥 Zhihu trending"
  },
  "douyin": {
    "zh-CN": "🔥 抖音热搜",
    "en": "🔥 Douyin trending"
  },
  "toutiao": {
    "zh-CN": "🔥 头条热搜",
    "en": "🔥 Toutiao trending"
  },
  "hitokoto": {
    "zh-CN": "💬 一言",
    "en": "💬 Quote"
  },
  "moyu": {
    "zh-CN": "🐟 摸鱼日历",
    "en": "🐟 Leisure calendar"
  },
  "lunar": {
    "zh-CN": "🌙 农历{month}{day} {year}年",
    "en": "🌙 Lunar date: {month}{day}, {year}"
  },
  "workday": {
    "zh-CN": "💼 今天是工作日",
    "en": "💼 Today is a workday"
  },
  "dayoff": {
    "zh-CN": "🎮 今天不上班",
    "en": "🎮 Today is a day off"
  },
  "countdown": {
    "zh-CN": "⏳ 距 {name} 还有 {days} 天",
    "en": "⏳ {days} days until {name}"
  },
  "ip": {
    "zh-CN": "🌐 IP 查询",
    "en": "🌐 IP lookup"
  },
  "currentIp": {
    "zh-CN": "当前 IP",
    "en": "Current IP"
  },
  "location": {
    "zh-CN": "位置: {value}",
    "en": "Location: {value}"
  },
  "isp": {
    "zh-CN": "运营商: {value}",
    "en": "ISP: {value}"
  },
  "bing": {
    "zh-CN": "🖼️ Bing 每日壁纸",
    "en": "🖼️ Bing daily wallpaper"
  },
  "gold": {
    "zh-CN": "💰 今日金价",
    "en": "💰 Gold prices today"
  },
  "goldName": {
    "zh-CN": "黄金",
    "en": "Gold"
  },
  "goldUnit": {
    "zh-CN": "元/克",
    "en": "CNY/g"
  },
  "goldPrice": {
    "zh-CN": "当前金价: ¥{price}/克",
    "en": "Current gold price: ¥{price}/g"
  },
  "fuel": {
    "zh-CN": "⛽ 今日油价",
    "en": "⛽ Fuel prices today"
  },
  "fuelPrice": {
    "zh-CN": "¥{price}/升",
    "en": "¥{price}/L"
  },
  "exchange": {
    "zh-CN": "💱 汇率查询",
    "en": "💱 Exchange rates"
  },
  "base": {
    "zh-CN": "基准货币: {value}",
    "en": "Base currency: {value}"
  },
  "updated": {
    "zh-CN": "更新时间: {value}",
    "en": "Updated: {value}"
  },
  "kfc": {
    "zh-CN": "🍗 疯狂星期四",
    "en": "🍗 KFC Thursday"
  },
  "duanzi": {
    "zh-CN": "😂 段子",
    "en": "😂 Joke"
  },
  "history": {
    "zh-CN": "📅 历史上的今天 ({date})",
    "en": "📅 Today in history ({date})"
  },
  "monthDay": {
    "zh-CN": "{month}月{day}日",
    "en": "{month}/{day}"
  },
  "translation": {
    "zh-CN": "🌐 翻译结果",
    "en": "🌐 Translation"
  },
  "source": {
    "zh-CN": "原文{language}: {text}",
    "en": "Original{language}: {text}"
  },
  "target": {
    "zh-CN": "译文{language}: {text}",
    "en": "Translation{language}: {text}"
  },
  "pronounce": {
    "zh-CN": "发音: {value}",
    "en": "Pronunciation: {value}"
  },
  "requestTimeout": {
    "zh-CN": "请求超时（30s）",
    "en": "Request timed out after 30s."
  },
  "requestFailed": {
    "zh-CN": "请求失败: {detail}",
    "en": "Request failed: {detail}"
  },
  "httpError": {
    "zh-CN": "API 请求失败: {status} {text}",
    "en": "API request failed: {status} {text}"
  },
  "jsonError": {
    "zh-CN": "API 返回非 JSON 响应 (content-type: {type})",
    "en": "API returned a non-JSON response (content-type: {type})"
  },
  "apiError": {
    "zh-CN": "API 错误: {code}",
    "en": "API error: {code}"
  }
});
