---
name: checkin_query
description: 查询用户的签到积分信息
parameters:
  user_id:
    type: string
    description: 用户ID（可选，不填则返回统计摘要）
tags: [签到, 积分, 查询]
keywords: [签到, 积分, 查询积分]
handler: ./handler.ts
---
