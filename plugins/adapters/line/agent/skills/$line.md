---
name: line
platforms:
  - line
description: >-
  LINE Messaging API 适配器技能。当用户在 LINE 私聊或群组中发送消息时，
  框架通过 Webhook 接收并处理。支持文本、图片、视频、音频、文件、位置、贴纸
  等消息类型。回复消息使用 Reply API（自动引用上下文），主动发送使用 Push API。
keywords:
  - line
  - adapter:line
  - messaging-api
  - webhook
tags:
  - im
  - adapter
---
# LINE Messaging API 技能

LINE 的 Messaging API 基于 Webhook 模式：平台将事件 POST 到指定 URL，适配器签名验证后处理。

## 消息接收

- 文本消息：直接转发为 text segment
- 媒体消息（image/video/audio/file）：包含 message_id，可通过 Content API 获取
- 位置消息：包含经纬度和地址
- 贴纸消息：包含 packageId 和 stickerId

## 消息发送

- **Reply API**：有 replyToken 时自动使用，回复会关联原始消息
- **Push API**：无 replyToken 时使用，主动推送到 userId/groupId/roomId
- 单次最多 5 条消息，单条文本最多 5000 字符

## 限制

- 不支持消息撤回
- 不支持已读回执（read receipt）
- 媒体消息仅提供 message_id，需额外 API 调用获取内容
