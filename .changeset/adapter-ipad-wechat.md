---
"@zhin.js/adapter-ipad-wechat": patch
---

新增微信 iPad 适配器 `@zhin.js/adapter-ipad-wechat`（适配器名 `ipad-wechat`）：通过 `@wchats/ipad` SDK（iPad 协议、本地签名模块 `@wchats/ipad-sign`，均为可选 peer）接入个人微信。支持恢复会话或扫码登录（二维码进 Console 登录面板）、可选设备验证页；收私聊/群聊文本与图片，发文本、群 @ 与图片；好友、群与群成员列表。入站在 Zhin 接纳后才 ACK，出站结果未知时报告 `unknown` 且不重发。
