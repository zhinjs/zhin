---
name: earthquake
description: >-
  地震查询能力。当用户询问最近哪里地震、某地是否地震、震级多大或想了解地震速报时使用。
  数据来自中国地震台网（CENC）与 USGS，合并去重后返回。
keywords:
  - earthquake
  - 地震
  - 震级
  - 余震
  - 地震速报
tags:
  - earthquake
  - realtime
tools:
  - recent_earthquakes
---

# 地震查询技能

## 工具

| 工具 | 用途 | 参数 |
|------|------|------|
| `recent_earthquakes` | 查询最近的地震 | `limit`（条数，默认 5）、`minMagnitude`（最小震级，默认 3）、`region`（地区关键词）、`hours`（时间范围，默认 24） |

**Example:**
```
用户: 刚才四川是不是地震了？
→ recent_earthquakes(region="四川", hours=6, minMagnitude=2)
```

## 注意

- 地区是对地点文字的关键词匹配；`中国` / `国内` 表示中国境内（含台湾）。
- 回答时说明数据来源与发震时刻的时区；数据源不可用时如实告知，不要编造地震信息。
- 订阅群推送请引导用户使用聊天命令 `地震 订阅 [最小震级] [地区...]`。
