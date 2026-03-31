---
name: toutiao_hot
description: 获取今日头条热搜榜
parameters:
  limit:
    type: number
    description: 返回条数，默认10条
tags: [热搜, 资讯, 头条]
keywords: [头条, 今日头条, 热搜, toutiao, tt]
command:
  pattern: "toutiao [limit:number]"
  alias: [头条热搜, tt]
  examples: ["/toutiao", "/tt 20"]
handler: ./toutiao-handler.ts
---
