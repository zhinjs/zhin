---
name: qrcode
description: >-
  二维码生成能力。当用户想把文本或 URL 转成二维码图片时使用。
  用户说「生成个二维码」「帮我做个二维码」或给了一个链接想生成二维码时应触发。
keywords:
  - qrcode
  - 二维码
  - QR
  - 扫码
  - 生成
tags:
  - qrcode
  - utility
tools:
  - qrcode_generate
---

# 二维码生成技能

## 工具

| 工具 | 用途 | 参数 |
|------|------|------|
| `qrcode_generate` | 生成二维码图片 | `text`（要编码的文本或 URL） |

**Example:**
```
用户: 把这个链接做成二维码 https://example.com
→ qrcode_generate(text="https://example.com")
```

生成 300×300 像素的 PNG 图片，支持任意文本和 URL。

## 注意

- 二维码扫描功能通过聊天命令 `扫码 <url>` 使用，不是 AI 工具。
- 文本过长可能导致二维码密度过高、难以扫描。建议先 `short_url` 缩短链接再生成。
