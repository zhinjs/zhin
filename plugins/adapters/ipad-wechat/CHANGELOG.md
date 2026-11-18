# @zhin.js/adapter-ipad-wechat

## 0.0.2

### Patch Changes

- 5612b42: ipad-wechat 声明入站媒体目录 `<dataDir>/media/inbound`（#1250 第 44 批）：开启 `downloadImages` 时下载的入站图片仍能被 Agent 读取；目录外的本机路径照旧不读。
- 2534b1d: 适配器不再替模型或用户在本机请求内网地址（#1250 第 46 批 `outbound-media-ssrf`）。

  - 出站媒体在本机下载时统一走 `@zhin.js/core` 新增的 `fetchOutboundMedia()`：只下载公网 HTTPS；主机名解析出的地址只要有一个是私网、回环、链路本地或云元数据地址就拒绝；连接只连已校验的地址（防 DNS 重绑定，也不经环境代理重新解析）；重定向逐跳重新校验；默认最大 25 MB、30 秒。原先 Agent 回复里的任意 `http(s)` 媒体地址都会被直接 `fetch`，内网响应（例如 `http://169.254.169.254/…`）会作为图片或文件发进聊天。
  - 涉及：飞书 / 企业微信 / 公众号的素材上传，iPad 微信图片（https 地址也不再交给 SDK 在本机下载），KOOK 卡片图片与 `uploadMedia`，Slack 文件，Discord 附件（不再让 discord.js 下载 URL），邮件附件（不再让 nodemailer 下载 URL），微信 iLink 媒体，ICQQ 媒体（不再让 SDK 下载 URL），QQ Markdown 图片尺寸探测。平台服务端自己下载 URL 的发送方式不变。
  - 地址被拒时这条消息照常发出，该媒体换成说明文字（如「[图片未发送：媒体地址不被允许]」）；日志记 `op: outbound_media_url_blocked`（超过大小为 `outbound_media_too_large`）和主机名，不记完整地址。iPad 微信、ICQQ 的 https 媒体现在先在本机经上述校验下载，再以字节交给 SDK。
  - 行为变化：不只是 Agent 回复，插件或指令主动发送的媒体，只要地址是内网、回环、链路本地、云元数据地址或 `http:`，且由适配器在本机下载，现在同样换成说明文字，不再下载发送；需要发送这类内容时请先读成字节（base64）再发。
  - 下载有总时限（默认 30 秒，含 DNS 解析与排队；故意慢回的 DNS 不会拖过时限），本机同时最多 8 个出站媒体下载，其余排队，排队中同样受取消与时限控制；调用方传入的请求头（如 `Authorization`）只发给首个地址的同源（协议 + 主机 + 端口），跨源重定向时丢弃；TLS SNI 去掉主机名末尾的点。
  - 飞书 / 企业微信 / 公众号 `resolveMediaBinary()` 的 `MediaResolveOptions.download` 保留但标为 `@deprecated` 且不再生效：URL 一律经 `fetchMedia`（默认 `fetchOutboundMedia`）下载，调用方不能借它绕过 SSRF 校验；请改用 `fetchMedia`。
  - QQ 图片尺寸探测遇到忽略 `Range`、返回整图的服务器时按探测失败处理（降级为不带尺寸），不算地址被拒，日志降为 debug；KOOK `uploadMedia` 识别大写的 `HTTP(S)://` 地址。
  - 入站识图、模型引用媒体的下载（`fetchUrlAsBase64`）改用同一套固定 IP 下载：此前预检 DNS 后由全局 `fetch` 连接，连接时会重新解析（DNS 重绑定，或在 `NODE_USE_ENV_PROXY=1` 时交给代理解析）。
  - SSRF 地址规则、固定 IP 传输和 `fetchPublicMediaBytes()` 移到 `@zhin.js/kernel`（`@zhin.js/agent` 原导出保持不变）；`fetchPublicMediaBytes()` 新增可选 `allowedDomains`、`headers`，`NodeNetworkTransport` 可注入 `lookup` / `connect`。

- Updated dependencies [3cf5a4f]
- Updated dependencies [9ce43fe]
- Updated dependencies [661cc7c]
- Updated dependencies [4ff83f3]
- Updated dependencies [1dc5324]
- Updated dependencies [4bd5b64]
- Updated dependencies [2534b1d]
  - @zhin.js/console-contract@1.4.0
  - @zhin.js/core@1.12.0
  - @zhin.js/adapter@1.4.0
  - @zhin.js/feature-kit@1.1.20
  - @zhin.js/page@1.2.2

## 0.0.1

### Patch Changes

- f086e19: 新增微信 iPad 适配器 `@zhin.js/adapter-ipad-wechat`（适配器名 `ipad-wechat`）：通过 `@wchats/ipad` SDK（iPad 协议、本地签名模块 `@wchats/ipad-sign`，均为可选 peer）接入个人微信。支持恢复会话或扫码登录（二维码进 Console 登录面板）、可选设备验证页；收私聊/群聊文本与图片，发文本、群 @ 与图片；好友、群与群成员列表。入站在 Zhin 接纳后才 ACK，出站结果未知时报告 `unknown` 且不重发。
