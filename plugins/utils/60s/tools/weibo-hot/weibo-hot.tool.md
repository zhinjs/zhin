---
name: weibo_hot
description: 获取微博热搜榜
tags: [热搜, 社交, 微博]
keywords: [微博, 热搜, weibo, wb]
parameters:
  limit:
    type: number
    description: 返回条数，默认10条
command:
  pattern: "weibo [limit:number]"
  alias: [微博热搜, wb]
  examples: ["/weibo", "/weibo 20"]
handler: ./handler.ts
---
