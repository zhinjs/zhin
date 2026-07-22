---
"@zhin.js/scaffold-wizard": minor
---

weixin-ilink 向导支持扫码绑定：默认展示终端二维码（`qrcode` 渲染 + 链接兜底），微信 ClawBot 扫码确认后自动获取 `bot_token` 写入 `.env`（`WEIXIN_ILINK_TOKEN`），`zhin.config.yml` 只生成 `${WEIXIN_ILINK_TOKEN}` 引用；支持过期/超时重试与手动输入 token 降级。扫码 HTTP 流程内联实现（协议对齐 `adapter-weixin-ilink` 的 `login.ts`），向导在适配器包安装前即可运行。
