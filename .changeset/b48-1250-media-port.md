---
"@zhin.js/kernel": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": patch
---

出站 / 入站媒体下载只连默认端口（#1250 第 48 批，第 46 批安全审查 L3；**行为变化**）。

- `fetchPublicMediaBytes()`（kernel）与 `fetchOutboundMedia()`（core）默认只接受 https 的 443，以及 `allowHttp` 时 http 的 80（URL 不写端口或写默认端口都算）；其他端口（如 `https://public-host:22/`、`:8443`、`:0`）一律拒绝，重定向的每一跳同样检查，防止借实例对任意公网主机和端口发起 TLS 握手做端口探测。
- 被拒时沿用 `blocked` / `outbound_media_url_blocked`，附 `reason: 'port'`（`PublicMediaFetchResult` 与 `OutboundMediaFetchError` 新增可选 `reason`，日志行带 `reason=port`）；说明文字和日志只含主机名，不含完整 URL。
- 新增可选参数 `allowedPorts?: readonly number[]`（`PublicMediaFetchOptions` / `OutboundMediaFetchOptions`）用于注入额外端口；默认不放开，不提供配置项。
- 入站识图 `fetchUrlAsBase64()`（agent）与语音转写下载随之生效；语音下载失败日志的 `reason` 为 `blocked:port`。
