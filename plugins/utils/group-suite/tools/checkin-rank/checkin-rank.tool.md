---
name: checkin_rank
description: 获取积分排行榜数据
parameters:
  limit:
    type: number
    description: 返回前 N 名（默认10）
tags: [签到, 排行]
keywords: [排行, 积分排行, 签到排行]
handler: ./handler.ts
---
