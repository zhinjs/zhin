---
"@zhin.js/adapter-satori": patch
---

群成员列表改为请求 `POST /v1/guild.member.list`。原先资源名写成 `guild-member`，实际打到 `/v1/guild-member.list`，与 Satori 文档不一致。
