---
name: wechat-mp
platforms:
  - wechat-mp
description: >-
  微信公众号适配器：通过 Webhook 接收用户消息、自动管理 Access Token、
  支持 XML 消息解析和 AES 消息加解密。纯消息通道，无额外 AI 工具。
  当上下文涉及微信公众号消息交互时可参考此技能了解能力边界。
keywords:
  - wechat
  - weixin
  - adapter:wechat-mp
  - 微信
  - 公众号
  - official-account
  - mp
tags:
  - wechat
  - adapter
  - social
tools: []
---

# 微信公众号适配器

纯消息通道，收发微信公众号用户消息。无 AI 工具可调用。

## 能力

- 通过 HTTP 回调接收微信推送的用户消息事件
- 自动刷新 Access Token，无需手动维护
- 支持签名验证和 AES 消息加解密
- 回复通过常规 `$reply` 发送
