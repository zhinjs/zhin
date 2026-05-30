---
name: stats_query
description: 查询消息统计数据
parameters:
  group_id:
    type: string
    description: 群ID（可选，不填查全局）
  period:
    type: string
    description: "时段: today/week/month（默认today）"
    enum: [today, week, month]
    default: today
tags: [统计, 消息]
keywords: [统计, 消息统计, 消息量]
handler: ./handler.ts
---
