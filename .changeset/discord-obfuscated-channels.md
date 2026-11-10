---
"@zhin.js/adapter-discord": patch
---

fix(adapter-discord): `listChannels` 默认过滤 Discord 混淆频道（`flags` 含 `CHANNEL_OBFUSCATED` = `1 << 17`）。自 2026-11-16 起，机器人缺少 `VIEW_CHANNEL` 的频道会以 `___hidden___` 名称经 Gateway 下发，而 HTTP `GET /guilds/{id}/channels` 不再返回它们。Console 频道列表不再显示机器人无权查看的频道，与 Discord HTTP 列表一致。在 Discord 开发者后台 Overview > Bot 打开 Private Channel Obfuscation，可以让 Gateway 提前下发这些混淆频道（该开关是临时测试；HTTP 列表没有对应的提前开关）。
