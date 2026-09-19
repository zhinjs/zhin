---
name: satori
platforms:
  - satori
description: >-
  Satori 协议适配器：支持 WebSocket（正向）和 Webhook 两种连接方式，
  实现 Satori 标准协议的消息收发。纯消息通道，无额外 AI 工具。
  Satori 是跨平台的统一协议，可对接多种 IM 后端。
keywords:
  - satori
  - adapter:satori
  - protocol
  - websocket
  - webhook
  - 协议
  - 跨平台
tags:
  - satori
  - protocol
  - adapter
tools: []
---

# Satori 协议适配器

纯协议适配器，收发消息。无 AI 工具可调用。

## 连接模式

- **WS 正向**：Bot 主动连接 Satori 服务端
- **Webhook**：Satori 向配置的 URL 推送事件

Satori 是跨平台统一协议，可作为中间层对接 QQ、Discord、Telegram 等后端。
