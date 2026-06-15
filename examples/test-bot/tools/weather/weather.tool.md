---
name: get_weather
description: 查询指定城市的实时天气（温度、体感、湿度、风速、降水等）。
parameters:
  city:
    type: string
    description: 城市名，如 成都、北京、上海
    required: true
keywords: [天气, 气温, 温度, 下雨, 降雨, 预报, weather, forecast, 湿度, 风力]
tags: [weather, utility]
handler: ./handler.ts
---
