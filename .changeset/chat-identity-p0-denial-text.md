---
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/agent": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-icqq": patch
---

聊天角色引导文案（ADR 0060 P0）：需要 zhin 角色的命令被拒绝时，回复说明去哪里获得角色（联系主人 / Console「聊天角色」页），不点名缺哪个角色或谁持有；发言者是群主 / 群管理员时另说明平台身份不等于 zhin 角色。`功能` / `角色` 的拒绝回复同样指向 Console，尚无全局 owner 时提示认领码；Agent 信任档位的限制说明改为「联系主人授予 trusted 角色」。Sandbox 页把模拟的「Master」改称「群主（平台身份）」，并显示服务端解析的 zhin 角色与 Agent 信任档位（入站回显帧新增 `senderChatRole` / `senderTrustLevel`）。ICQQ README 去掉已不读取的 `master`「必填」写法。
