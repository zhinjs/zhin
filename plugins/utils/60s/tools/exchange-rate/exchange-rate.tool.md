---
name: exchange_rate
description: 查询货币汇率
tags: [金融, 汇率, 查询]
keywords: [汇率, 兑换, 外汇, exchange, rate]
parameters:
  from:
    type: string
    description: 源货币，如 USD, EUR, JPY
  to:
    type: string
    description: 目标货币，如 CNY
handler: ./handler.ts
---
