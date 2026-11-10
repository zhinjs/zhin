---
"@zhin.js/adapter-discord": patch
---

fix(adapter-discord): `listChannels` 默认过滤 Discord 混淆频道（`flags` 含 `CHANNEL_OBFUSCATED` = `1 << 17`）。自 2026-11-16 起，机器人缺少 `VIEW_CHANNEL` 的频道会以 `___hidden___` 名称经 Gateway 下发，而 HTTP `GET /guilds/{id}/channels` 不再返回它们；过滤后两条路径的结果保持一致。
