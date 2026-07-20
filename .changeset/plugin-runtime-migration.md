---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/schedule": patch
"@zhin.js/pagemanager": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/process-monitor": patch
"@zhin.js/service-activity-feedback": patch
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
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-link-poster": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-music": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-short-url": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
"@zhin.js/game-kit": patch
"@zhin.js/logger": patch
"@zhin.js/database": patch
"create-zhin-app": patch
"@zhin.js/docs": patch
---

约定式插件运行时迁移（breaking）：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等）。

- 新增约定式运行时包：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`（首版 1.0.0 走 init-publish，不在本 changeset 内 bump）。
- 全部 20 个平台适配器改为约定式 `defineAdapter`，旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook/wss、satori webhook、kook webhook、qq webhook/middleware 等 slice 1 推迟的连接模式已补齐。
- 游戏 / 工具 / 服务插件同步迁移到约定目录结构。
- CLI 增加 plugin-runtime host installer（http/database/outbound/schedule/console 等）。

后续加固（同批）：

- CLI：`zhin runtime start --daemon`（pidfile/崩溃拉起/风暴保护），orphan watchdog 防僵尸进程；legacy `zhin dev` / `zhin start` 已移除（含 `zhin restart`），`zhin stop` 兼容新 daemon。
- 安全：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；`splitCompoundCommand` 引号感知、`extractCommandName` 去引号堵绕过。
- 日志：Logger 双堆栈修复、本地时区、`getLogger` 挂树（`setLevel` 递归生效）、第三方库（log4js/discord）桥接、启动人读总结。
- 结构：`plugins/games/shared` 迁为 `packages/game-kit`（`@zhin.js/game-kit`）；死目录 `plugins/adapters/common` 删除。
- 脚手架：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态（minimal-bot 同构，新配置格式）。
- Console：endpoint.list 真实名称与 phase、schema:get-all 按 instanceKey 映射、db:* 接 DatabaseHost。

注：按仓库发布惯例（见 1bb345dd2），本次 breaking 迁移统一使用 patch，避免 zhin.js 5.0 级联。
