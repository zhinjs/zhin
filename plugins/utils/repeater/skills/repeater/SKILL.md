---
name: repeater
description: >-
  复读机：群内连续多人发送相同消息时 Bot 自动跟读。纯中间件行为，
  由阈值和冷却配置控制，无 AI 工具。
keywords:
  - repeater
  - 复读
  - 复读机
  - 跟读
  - echo
tags:
  - repeater
  - fun
  - group
tools: []
---

# 复读机

中间件自动检测群内连续相同消息，达到阈值后 Bot 跟读一次。无 AI 工具可调用。

## 行为

- 默认阈值：连续 3 条相同消息触发跟读
- 跟读后进入冷却期，避免刷屏
- 通过命令 `repeater-status` 查看/切换当前群的开关状态
