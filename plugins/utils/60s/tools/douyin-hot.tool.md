---
name: douyin_hot
description: 获取抖音热搜榜
parameters:
  limit:
    type: number
    description: 返回条数，默认10条
tags: [热搜, 短视频, 抖音]
keywords: [抖音, 热搜, douyin, dy]
command:
  pattern: "douyin [limit:number]"
  alias: [抖音热搜, dy]
  examples: ["/douyin", "/douyin 20"]
handler: ./douyin-handler.ts
---
