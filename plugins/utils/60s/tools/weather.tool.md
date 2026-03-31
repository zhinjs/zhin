---
name: weather
description: 查询指定城市的当前天气信息
parameters:
  city:
    type: string
    description: 城市名称，如"成都"、"北京"
    required: true
tags: [天气, 生活, 查询]
keywords: [天气, 气温, 温度, 下雨, 晴天, 阴天, weather]
command:
  pattern: "weather <city:text>"
  alias: [天气, tq]
  examples: ["/weather 成都", "/天气 北京"]
handler: ./weather-handler.ts
---
