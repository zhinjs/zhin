---
name: github-subscriptions
platforms:
  - github
description: GitHub Star 与仓库订阅管理能力。
keywords:
  - "github"
  - "star"
  - "订阅"
  - "通知"
tools:
  - "star"
  - "subscribe"
  - "subscriptions"
  - "unsubscribe"
---

# github-subscriptions

先用 `subscriptions` 查询当前聊天通道的已有订阅，再执行订阅或取消。Webhook 订阅绑定当前聊天通道，只会向该通道投递事件。`star` 优先使用用户绑定的 OAuth 身份，未绑定时才使用 Endpoint 默认身份；外部写操作遵守审批策略。
