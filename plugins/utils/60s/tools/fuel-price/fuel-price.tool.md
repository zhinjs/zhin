---
name: fuel_price
description: 查询今日油价
tags: [生活, 油价, 价格]
keywords: [油价, 汽油, 柴油, fuel]
parameters:
  province:
    type: string
    description: 省份名称，如"四川"、"北京"
command:
  pattern: "fuel [province:text]"
  alias: [油价, yj]
  examples: ["/fuel", "/油价 四川"]
handler: ./handler.ts
---
