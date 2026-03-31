---
name: ip_query
description: 查询 IP 地址的地理位置信息
parameters:
  ip:
    type: string
    description: IP 地址，不填则查询当前 IP
tags: [网络, 查询, IP]
keywords: [ip, IP, IP查询, ip查询]
command:
  pattern: "ip [ip:text]"
  alias: [IP查询]
  examples: ["/ip", "/ip 8.8.8.8"]
handler: ./ip-handler.ts
---
