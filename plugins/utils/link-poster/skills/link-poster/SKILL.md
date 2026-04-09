---
name: link-poster
description: 链接海报卡片：自动识别 Bilibili、GitHub、抖音、小红书链接，生成精美预览卡片图片。
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

## 执行规则

- 通过中间件自动检测消息中的链接，无需手动调用
- 支持平台：Bilibili（视频/专栏）、GitHub（仓库/Issue/PR）、抖音、小红书
- 依赖 html-renderer 插件将 HTML 渲染为图片
- 无独立 AI 工具，纯自动触发
