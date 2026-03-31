---
name: greet
description: 生成个性化问候语
parameters:
  name:
    type: string
    description: 用户名
    required: true
  time:
    type: string
    description: 时间段
    enum: [morning, afternoon, evening]
    default: morning
keywords: [问候, 你好, hello]
tags: [utility]
---

你好，{{name}}！{{time}}好，欢迎来到 Zhin 机器人世界。
