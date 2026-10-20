---
name: short-url
description: >-
  短链接生成能力。当用户想缩短一个长 URL 或生成短链时使用。
  用户说「帮我缩短这个链接」「转成短链」或给了一个很长的 URL 时应触发。
keywords:
  - short-url
  - 短链
  - shorten
  - URL
  - 链接
  - 缩短
tags:
  - short-url
  - utility
tools:
  - short_url
---

# 短链接生成技能

## 工具

| 工具 | 用途 | 参数 |
|------|------|------|
| `short_url` | 缩短 URL | `url`（原始链接，必须是 http/https） |

**Example:**
```
用户: 帮我缩短 https://very-long-domain.com/path/to/something?with=params&and=more
→ short_url(url="https://very-long-domain.com/path/to/something?with=params&and=more")
→ 返回: https://is.gd/xxxxx
```

使用 is.gd 服务生成短链接。

## 注意

- 输入必须是合法的 http/https URL。
- 展开短链查看原始地址的功能通过聊天命令 `展开 <url>` 使用。
