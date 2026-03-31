---
name: translate_60s
description: 翻译文本
tags: [工具, 翻译, 语言]
keywords: [翻译, 英文, 中文, 日文, translate, 译]
parameters:
  text:
    type: string
    description: 要翻译的文本
    required: true
  to:
    type: string
    description: 目标语言，如 en, zh, ja
command:
  pattern: "fanyi <text:text> [to:text]"
  alias: [翻译, fy]
  examples: ["/fanyi hello", "/翻译 你好 en"]
handler: ./handler.ts
---
