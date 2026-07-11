---
name: music
description: >-
  音乐搜索与分享能力。当用户想搜索歌曲、点歌、分享音乐、
  听某首歌或查找歌手的歌时使用。支持 QQ 音乐和网易云音乐两个平台。
  即使用户只是说「来首歌」「点个歌」或提到某首歌的名字，也应触发。
keywords:
  - music
  - 音乐
  - 歌曲
  - 搜索
  - 分享
  - QQ音乐
  - 网易云
  - 点歌
  - 听歌
tags:
  - music
  - entertainment
  - media
tools:
  - music_search
  - music_share
---

# 音乐搜索分享技能

搜索歌曲并以富文本卡片分享到聊天中。

## 工作流

典型的点歌流程是两步走：先搜后分享。

**Example:**
```
用户: 点一首周杰伦的晴天
步骤1: music_search(keyword="周杰伦 晴天", source="qq") → 获取歌曲列表
步骤2: music_share(id=搜索结果中的歌曲ID, source="qq") → 发送卡片
```

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `music_search` | 搜索歌曲 | `keyword`（关键词）, `source`（qq/163）, `count`（数量） |
| `music_share` | 分享歌曲 | `id`（歌曲 ID，来自搜索结果）, `source`（qq/163） |

## 易错点

1. **search 和 share 的 source 必须一致**。QQ 音乐搜到的 ID 不能用网易云分享。
2. **分享需要 ID**，不能直接用歌名。必须先搜索获取 ID。
3. 用户没说平台时，默认用 QQ 音乐（`source="qq"`）。
