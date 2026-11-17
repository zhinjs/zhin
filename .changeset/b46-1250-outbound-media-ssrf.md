---
"@zhin.js/kernel": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-ipad-wechat": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
---

适配器不再替模型或用户在本机请求内网地址（#1250 第 46 批 `outbound-media-ssrf`）。

- 出站媒体在本机下载时统一走 `@zhin.js/core` 新增的 `fetchOutboundMedia()`：只下载公网 HTTPS；主机名解析出的地址只要有一个是私网、回环、链路本地或云元数据地址就拒绝；连接只连已校验的地址（防 DNS 重绑定，也不经环境代理重新解析）；重定向逐跳重新校验；默认最大 25 MB、30 秒。原先 Agent 回复里的任意 `http(s)` 媒体地址都会被直接 `fetch`，内网响应（例如 `http://169.254.169.254/…`）会作为图片或文件发进聊天。
- 涉及：飞书 / 企业微信 / 公众号的素材上传，iPad 微信图片（https 地址也不再交给 SDK 在本机下载），KOOK 卡片图片与 `uploadMedia`，Slack 文件，Discord 附件（不再让 discord.js 下载 URL），邮件附件（不再让 nodemailer 下载 URL），微信 iLink 媒体，ICQQ 媒体（不再让 SDK 下载 URL），QQ Markdown 图片尺寸探测。平台服务端自己下载 URL 的发送方式不变。
- 地址被拒时这条消息照常发出，该媒体换成说明文字（如「[图片未发送：媒体地址不被允许]」）；日志记 `op: outbound_media_url_blocked`（超过大小为 `outbound_media_too_large`）和主机名，不记完整地址。iPad 微信、ICQQ 的 https 媒体现在先在本机经上述校验下载，再以字节交给 SDK。
- 入站识图、模型引用媒体的下载（`fetchUrlAsBase64`）改用同一套固定 IP 下载：此前预检 DNS 后由全局 `fetch` 连接，连接时会重新解析（DNS 重绑定，或在 `NODE_USE_ENV_PROXY=1` 时交给代理解析）。
- SSRF 地址规则、固定 IP 传输和 `fetchPublicMediaBytes()` 移到 `@zhin.js/kernel`（`@zhin.js/agent` 原导出保持不变）；`fetchPublicMediaBytes()` 新增可选 `allowedDomains`、`headers`，`NodeNetworkTransport` 可注入 `lookup` / `connect`。
