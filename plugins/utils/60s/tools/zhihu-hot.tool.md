---
name: zhihu_hot
description: 获取知乎热榜
parameters:
  limit:
    type: number
    description: 返回条数，默认10条
tags: [热搜, 社交, 知乎]
keywords: [知乎, 热榜, zhihu, zh]
command:
  pattern: "zhihu [limit:number]"
  alias: [知乎热榜, zh]
  examples: ["/zhihu", "/zhihu 20"]
handler: ./zhihu-handler.ts
---
