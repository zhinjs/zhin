---
name: link-poster
description: >-
  链接海报卡片：自动识别消息中的 Bilibili、GitHub、抖音、小红书链接，
  生成精美预览卡片图片。纯中间件自动触发，无 AI 工具。
keywords:
  - link
  - poster
  - 链接
  - 卡片
  - bilibili
  - github
  - douyin
  - 抖音
  - xiaohongshu
  - 小红书
  - preview
  - 预览
tags:
  - link-poster
  - media
  - social
tools: []
---

# 链接海报卡片

中间件自动检测消息中的链接，生成预览卡片。无 AI 工具可调用。

## 支持平台

- **Bilibili**：视频/专栏 → 封面 + 标题 + UP 主
- **GitHub**：仓库/Issue/PR → Star 数 + 描述
- **抖音**：短视频 → 封面 + 标题
- **小红书**：笔记 → 封面 + 标题

依赖 `html-renderer` 插件将 HTML 模板渲染为图片。
