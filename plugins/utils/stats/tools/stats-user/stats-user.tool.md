---
name: stats_user
description: 查询指定用户的消息统计
parameters:
  user_id:
    type: string
    description: 用户ID
    required: true
tags: [统计, 用户]
keywords: [用户统计, 消息统计, 个人统计]
handler: ./handler.ts
---
