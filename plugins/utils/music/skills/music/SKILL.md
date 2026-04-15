---
name: music
description: 音乐搜索与分享：支持 QQ 音乐和网易云音乐，可搜索歌曲并生成分享卡片。
keywords:
  - music
  - 音乐
  - 歌曲
  - 搜索
  - 分享
  - QQ音乐
  - 网易云
  - 点歌
tags:
  - music
  - entertainment
  - media
tools:
  - music_search
  - music_share
---

## 工具概览

| 工具 | 说明 |
|------|------|
| `music_search` | 搜索歌曲（关键词、来源、数量） |
| `music_share` | 分享指定歌曲（歌曲 ID + 来源） |

## 执行规则

- 支持 QQ 音乐和网易云音乐两个来源
- 搜索后通过 `music_share` 分享具体歌曲
- 分享结果以富文本卡片呈现
