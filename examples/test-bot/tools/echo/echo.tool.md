---
name: echo
description: 回声工具，原样返回用户输入的文本
parameters:
  text:
    type: string
    description: 要回显的文本
    required: true
command:
  pattern: "echo <text:text>"
  alias: [回声]
keywords: [回声, echo]
tags: [utility]
handler: ./handler.ts
---
