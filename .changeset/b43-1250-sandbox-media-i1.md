---
"@zhin.js/adapter-sandbox": minor
"@zhin.js/console-protocol": patch
"@zhin.js/agent": patch
---

Sandbox 支持上传本地文件（ADR 0064 增补 I1，#1250 第 43 批）：图片、语音、任意文件可以拖放、粘贴或用按钮选择，上传后以签名地址发进会话，入站段与其他平台一致（`media.kind: 'url'`）。

- **存储**：文件存于项目的 `.zhin/sandbox/media/<端点目录键>/`，只按 128 位随机 id 命名，上传者给的文件名只进元数据，读取只认 id，不接受任何路径。元数据记录上传时的会话（端点 + 会话）、上传者、按内容嗅探的 MIME、大小与过期时间。重启后历史里的文件在有效期内仍可用。
- **上传**：`POST /api/sandbox/media/<endpoint>?type=&id=`，原始字节，必须带 `Content-Length`，需要 `endpoint.operate`。按类型限制大小（默认图片 10 MiB、语音 20 MiB、视频与其他文件 32 MiB，单文件硬顶 64 MiB，即网关的请求体上限，要更大需要同时调大网关），配额按上传者计（默认 200 MiB）并另有端点总配额（默认 500 MiB），超额直接拒绝，不删别人的文件。
- **签名地址**：`/pub/sandbox-media/<dir>/<id>?exp=&sig=`，HMAC-SHA256、常量时间比较；密钥在 `.zhin/sandbox/media/secret`（0600），保留 current / previous 两把，签发只用 current。有效期默认 24 小时，最长 168 小时；删除文件立即作废它的所有链接，所有者可轮换密钥或「全部作废」。
- **下载**：Console 页面经 `GET /api/sandbox/media/<endpoint>/<id>`（`endpoint.view`，且必须是文件所属的会话）显示文件；`/pub/sandbox-media` 默认关闭（`media.publicDownload: false`），开启后仍需有效、未过期的签名，来源地址从不作为授权依据。SVG、HTML 等非图片 / 音视频文件一律以附件下载，带 `X-Content-Type-Options: nosniff`。
- **会话绑定**：带着其他会话或他人上传的托管地址发消息会被拒绝（错误帧 `sandbox_media_rejected`）并记日志。
- `@zhin.js/console-protocol`：`CONSOLE_HTTP_PERMISSIONS` 登记 `POST` / `DELETE /sandbox/media/*` 为 `endpoint.operate`、`GET /sandbox/media/*` 为 `endpoint.view`（只在已有常量里加条目）。
- `@zhin.js/agent`：文件策略与 Shell 命令检查显式拒绝 `.zhin/sandbox/`（托管文件与签名密钥；`.zhin/` 原本已整体拒绝）。
- 本阶段插件与 Agent 还不能在进程内读取上传的文件，要等 I2（`LocalMediaSource`）；在此之前插件按网络地址下载时仍受它自己的域名白名单约束，Agent 暂时看不到上传的图片。
