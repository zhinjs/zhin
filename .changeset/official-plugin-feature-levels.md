---
"@zhin.js/schema": patch
"@zhin.js/testing": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-bilibili": patch
"@zhin.js/plugin-answers": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-nettools": patch
"@zhin.js/plugin-roulette": patch
"@zhin.js/service-activity-feedback": patch
"@zhin.js/process-monitor": patch
---

官方插件接入分层功能配置（ADR 0050 / 0055）：所有带配置 Schema 的官方插件都声明全部四级（全局 / 适配器 / 账号 / 会话），Console 的适配器、账号与会话页面都能开关它们；密钥、调度与全局资源类字段收窄为仅全局。answers 与 group-suite 可按会话覆盖字段并开放群内自助字段（答题超时、科目一开关；欢迎语、排行条数、教学冷却与分页），ledger 的 `reportWhenEmpty` 可按订阅者会话覆盖。主动推送在发送前按目标会话检查开关：提醒（含管理员提醒）、日历授权通知、地震速报、记账日报、彩票推送、B 站开播 / 动态推送、activity-feedback 的状态提示在已停用的账号或会话上不再发送；roulette 的超时扫描在已停用的会话里静默结束对局（不结算、不禁言、不发消息）。`@zhin.js/schema` 新增 `.fieldLevels(levels)` 用于收窄单个字段的层级；`@zhin.js/testing` 的假插件上下文提供 `isEnabledFor` / `configFor`（`feature` 选项可模拟按会话停用与字段覆盖）。
