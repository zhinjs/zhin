---
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-lark": patch
---

适配器 Agent 工具不再读取宿主文件、不再绕过出站发送链：

- 读取宿主文件的工具要求全局层 `owner`（`owner@global`）：飞书 `lark_upload_file`（本地路径）、NapCat `set_group_portrait`（另需 `bot:admin`）、`set_avatar`（同时是机器人账号身份）、`download_file`（由宿主网络拉取任意 URL 并写入宿主文件）。NapCat `ocr_image`、`send_group_notice` 的图片与 `send_forward_msg` 节点内的媒体只接受 http(s) 链接、`base64://` 或平台文件标识，拒绝 `file://` 与本机路径。
- 发消息的工具改经 IM 出站链（`outboundMessageToken` → 渲染 → 出站中间件 → Endpoint），平台特有内容用适配器的命名空间段：Discord `send_embed` → `discord:embed`；Telegram `send_poll` / `send_sticker` → `telegram:poll` / `telegram:sticker`（贴纸只接受 file_id 或 http(s) 链接）；NapCat `send_forward_msg` → `napcat:node`（OneBot `node` 段）；企业微信 `send_text` 以当前账号发往指定用户的会话。
- `pnpm check:harness-paths` 增加检查：适配器 Agent 工具直调平台发送接口即失败；无法由出站链表达的调用（钉钉工作通知、NapCat 单条原生转发与 AI 语音、Discord 建论坛帖 / 子线程）登记在 `scripts/agent-send-bypass-allowlist.json` 并写明理由。
