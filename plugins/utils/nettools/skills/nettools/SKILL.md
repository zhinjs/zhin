---
name: nettools
description: >-
  网络诊断与域名信息能力：多地 Ping、RDAP whois、DNS 查询、域名价格比价。
  用户问「某网站能不能访问 / 延迟多少」「这个域名什么时候到期」「查一下 MX/TXT 记录」
  「.com 哪家注册便宜」时使用。
keywords:
  - ping
  - whois
  - dns
  - 域名
  - 解析
  - 延迟
  - 域名价格
tags:
  - network
  - utility
tools:
  - net_ping
  - whois_lookup
  - dns_lookup
  - domain_price
---

# 网络工具技能

| 工具 | 用途 | 参数 |
|------|------|------|
| `net_ping` | 多地区 Ping（check-host.net） | `host`：公网域名或 IP |
| `whois_lookup` | 域名注册信息（RDAP） | `domain` |
| `dns_lookup` | DNS 查询（DoH） | `name`，`type`（默认 A） |
| `domain_price` | 域名价格比价（nazhumi.com） | `suffix`，`order`（register/renew/transfer） |

**Example:**
```
用户: github.com 的邮件服务器是哪些？
→ dns_lookup(name="github.com", type="MX")
```

## 注意

- 内网、回环、链路本地、组播、云元数据地址以及解析到这些地址的域名会被拒绝，直接把拒绝原因告诉用户即可，不要换写法重试。
- 每个用户有冷却时间；遇到「操作太频繁」时请让用户稍后再试，不要连续重复调用。
- 价格数据来自第三方聚合，提醒用户以注册商官网为准。
