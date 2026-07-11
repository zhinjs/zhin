---
name: "60s"
description: >-
  60s 聚合信息查询能力。当用户请求新闻、天气、热搜（微博/知乎/抖音/头条）、
  金价、油价、汇率、翻译、一言/每日一句、摸鱼日历、KFC 文案、段子、
  历史上的今天、IP 查询、Bing 每日壁纸时使用。即使用户没有提到 60s，
  只要涉及上述日常信息查询，就应触发。
keywords:
  - 60s
  - 新闻
  - 天气
  - 微博
  - 知乎
  - 抖音
  - 头条
  - 一言
  - 摸鱼
  - 金价
  - 油价
  - 汇率
  - 翻译
  - 历史
  - kfc
  - 段子
  - 壁纸
  - bing
  - ip
  - 热搜
tags:
  - 新闻
  - 资讯
  - 天气
  - 热搜
  - 生活
  - 金融
  - 娱乐
  - 工具
tools:
  - 60s_news
  - bing_image
  - douyin_hot
  - duanzi
  - exchange_rate
  - fuel_price
  - gold_price
  - history_today
  - hitokoto
  - ip_query
  - kfc
  - moyu
  - toutiao_hot
  - translate_60s
  - weather
  - weibo_hot
  - zhihu_hot
---

# 60s 聚合信息查询技能

一站式日常信息查询，覆盖新闻、天气、热搜、金融、娱乐等 17 个工具。

## 工具速查

根据用户意图选择对应工具：

| 用户说… | 用这个工具 |
|---------|-----------|
| 今天有什么新闻 / 60s 看世界 | `60s_news` |
| XX 天气怎么样 | `weather` |
| 微博热搜 | `weibo_hot` |
| 知乎热搜 | `zhihu_hot` |
| 抖音热搜 | `douyin_hot` |
| 今日头条 | `toutiao_hot` |
| 金价多少 | `gold_price` |
| 油价多少 | `fuel_price` |
| 美元汇率 / 人民币兑日元 | `exchange_rate` |
| 翻译一下 XX | `translate_60s` |
| 来句一言 / 每日一句 | `hitokoto` |
| 摸鱼日历 / 今天摸鱼 | `moyu` |
| KFC 文案 / 疯狂星期四 | `kfc` |
| 来个段子 | `duanzi` |
| 历史上的今天 | `history_today` |
| 查 IP / 我的 IP | `ip_query` |
| Bing 壁纸 / 每日壁纸 | `bing_image` |

## 易错点

1. **weather 需要城市名参数**，用户没说城市时需要先确认。
2. **exchange_rate 需要币种参数**，如 USD、JPY、EUR 等。
3. **translate_60s 是简易翻译**，对于复杂翻译任务应建议使用专业翻译工具。
4. **热搜类工具不需要参数**，直接调用即可获取当前热搜列表。
