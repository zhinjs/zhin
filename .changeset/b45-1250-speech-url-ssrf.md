---
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/plugin-content-moderation": patch
---

语音转写和内容审核不再替远端用户请求内网地址（#1250 第 45 批 `speech-url-ssrf`）。

- Speech Host 下载语音（入站语音段的地址、`metadata.audio_url`、Sandbox 手写的 `[audio:URL]`）和 `voice_stt` 的 `audio_url` 改走新增的 `fetchPublicMediaBytes()`（`@zhin.js/agent/security`）：只下载公网 HTTPS 地址；主机名解析出的地址只要有一个是私网、回环、链路本地或云元数据地址就拒绝，连接时只连已校验的地址（防 DNS 重绑定）；重定向逐跳重新校验；单个语音最大 25 MB、整次下载 30 秒。原先任意 `http(s)` 地址都会被直接 `fetch`。
- 被拒的地址不发出任何请求，这一轮照常继续：`transcribeUrl` 返回 `{ status: 'refused', code: 'speech_url_blocked' }`，模型看到「[语音地址不可用，未转写（speech_url_blocked）]」，`voice_stt` 返回同样原因的 `{ error }`。日志记 `op: speech_url_blocked`（下载失败为 `speech_url_fetch_failed`）和主机名，不记完整地址。转写器抛错时回合也不再中断。没有内网主机白名单配置。
- 内容审核 HTTP 源在 `forceUpload` 时下载聊天图片，改为只连公网地址（私网、回环、链路本地、元数据地址及解析到这些地址的域名、重定向的每一跳都拒绝），单张最大 20 MB、超时用该源的 `timeoutMs`；被拒时按该源的 `onError` 处理。
