---
"@zhin.js/scaffold-wizard": minor
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
---

适配器配置格式定稿（不兼容旧格式）：`plugins.<adapter>` 顶层仅共享字段 + `commandPrefix`，`endpoints[i]` 携带 endpoint 级字段（`name` + 凭据，各 schema 已类型化），`endpoints` 为必填（icqq 另需顶层 `master`）；icqq 新增 `trusted` 列表（顶层/逐项均可）。scaffold-wizard 全部字段式与自定义 configure() 产出改为新格式，examples（full-bot / qq-games-bot）与 20 个适配器 README 同步迁移。
