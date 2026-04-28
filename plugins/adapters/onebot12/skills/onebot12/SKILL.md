---
name: onebot12
platforms:
  - onebot12
description: >-
  OneBot 12 协议适配器：支持 WebSocket 正向连接、Webhook 回调和反向 WebSocket
  三种连接模式，兼容 OneBot 12 标准协议。纯消息通道，无额外 AI 工具。
  支持私聊、群聊、频道消息。
keywords:
  - onebot12
  - onebot
  - adapter:onebot12
  - protocol
  - websocket
  - webhook
  - 协议
tags:
  - onebot12
  - protocol
  - adapter
tools: []
---

# OneBot 12 协议适配器

纯协议适配器，收发消息。无 AI 工具可调用。

## 连接模式

- **WS 正向**：Bot 主动连接 OneBot 12 服务端
- **Webhook**：OneBot 12 向配置的 URL 推送事件
- **WS 反向**：OneBot 12 主动连接 Bot 的 WS 服务端

## 与 OneBot11 的区别

OneBot 12 标准化了事件格式、消息段类型和 API 响应结构。如果需要群管理等 AI 工具，使用 OneBot11 适配器。
