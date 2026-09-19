---
name: email
platforms:
  - email
description: >-
  邮件适配器：通过 SMTP 发送和 IMAP 接收邮件，支持附件处理、TLS 加密和定时轮询收信。
  纯消息通道适配器，无额外 AI 工具。当上下文涉及邮件收发时可参考此技能了解能力边界。
keywords:
  - email
  - adapter:email
  - 邮件
  - smtp
  - imap
  - mail
  - 收件
  - 发件
tags:
  - email
  - mail
  - adapter
tools: []
---

# 邮件适配器

纯消息通道，通过 SMTP 发送、IMAP 接收邮件。无 AI 工具可调用。

## 能力

- 通过 IMAP 定时轮询收取新邮件，转为 Zhin 消息事件
- 通过 SMTP 发送回复，支持附件和 TLS/SSL 加密
- 消息通过常规 `$reply` 发送，无需专用工具
