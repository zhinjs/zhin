---
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-short-url": patch
"@zhin.js/plugin-link-poster": patch
---

语音转写和内容审核不再替远端用户请求内网地址（#1250 第 45 批 `speech-url-ssrf`）。

- Speech Host 下载语音（入站语音段的地址、`metadata.audio_url`、Sandbox 手写的 `[audio:URL]`）和 `voice_stt` 的 `audio_url` 改走新增的 `fetchPublicMediaBytes()`（`@zhin.js/agent/security`）：只下载公网 HTTPS 地址；主机名解析出的地址只要有一个是私网、回环、链路本地或云元数据地址就拒绝，连接时只连已校验的地址（防 DNS 重绑定）；重定向逐跳重新校验；单个语音最大 25 MB、整次下载 30 秒。原先任意 `http(s)` 地址都会被直接 `fetch`。
- 被拒的地址不发出任何请求，这一轮照常继续：`transcribeUrl` 返回 `{ status: 'refused', code: 'speech_url_blocked' }`，模型看到「[语音地址不可用，未转写（speech_url_blocked）]」，`voice_stt` 返回同样原因的 `{ error }`。日志记 `op: speech_url_blocked`（下载失败为 `speech_url_fetch_failed`）和主机名，不记完整地址。转写器抛错时回合也不再中断。没有内网主机白名单配置。
- 内容审核 HTTP 源在 `forceUpload` 时下载聊天图片，改为只连公网地址（私网、回环、链路本地、元数据地址及解析到这些地址的域名、重定向的每一跳都拒绝），单张最大 20 MB、超时用该源的 `timeoutMs`；被拒时按该源的 `onError` 处理。
- 共用的私网地址判定（`isBlockedIpAddress`，`TurnNetworkClient`、`fetchPublicMediaBytes` 和入站媒体下载都用它）把 IPv6 改为白名单：只认全局单播 `2000::/3`，并排除 Teredo、6to4、文档和基准测试段；NAT64（`64:ff9b::/96`、`64:ff9b:1::/48`）、IPv4 兼容地址 `::/96`、站点本地 `fec0::/10`、丢弃段 `100::/64` 这类能映射到内网 IPv4 的地址此前会被放行，现在一律拒绝。IPv4 另外拒绝 Azure WireServer `168.63.129.16`、6to4 中继段和文档段。
- 内容审核、RSS、短链接、链接海报共用的 `public-fetch` 以前校验时解析一次域名，`fetch` 连接时再解析一次，DNS 重绑定可以在两次之间换成内网地址；现在连接直接连校验过的那个地址（TLS 的 SNI 与 `Host` 仍是原主机名，不经环境代理），压缩的响应在本机解压后再按上限计数；重定向到其他源时不再带上 `Authorization` / `Cookie` / `Proxy-Authorization`。
