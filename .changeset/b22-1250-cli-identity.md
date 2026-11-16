---
"@zhin.js/cli": minor
"@zhin.js/agent": minor
"@zhin.js/gateway": minor
"@zhin.js/plugin-runtime": minor
"zhin.js": minor
---

CLI 与聊天身份（zhinjs/zhin#1250 第 22 批）：

- `ai.personalPrincipals`（ADR 0060 P3）：首次导入时因键不是 `user:<id>` 而跳过（`not-a-user`）的条目不再算作已迁移。在首次导入后 30 天内改正键，`adapterId` 与 `subjectId` 相同的条目在下次启动按首次导入处理，不进入「等待 Console 确认」；每个身份只能改正一次，首次导入之后被确认、忽略或导入过的身份不再适用，改键时新加的身份、首次导入之后才出现的无效键仍需确认，持有授予的人仍不会被自动链接，改正导入写审计并重新显示在「需要你处理」里。首次导入之后新增、适配器当时未加载的条目，加载后也改为等待确认（此前会被自动链接；1.4.0 记录里晚于首次导入的这类条目同样）。1.4.0 写下的记录里已在等待确认或已被忽略的条目保持原状。
- 键无效时，实例警告说明改正后会怎样；网关在实例启动后把建议的键写进网关自己的日志（前台运行时的终端、后台运行时的 `.zhin/logs/gateway.log`；不写进 Console 可读的实例日志，实例日志只提示运行 `zhin console user list`）：键正好是某个用户名时给出该用户的 `user:<id>`，只有一个所有者时给出「当前唯一的所有者是 …，可改为 `user:<id>`」。不接受用户名作键：用户删除后同名可被别人重新注册。`@zhin.js/gateway/iam` 新增 `personalPrincipalKeyHints()`、`personalPrincipalKeysOf()`。
- `zhin console user list` 显示用户 id，新增 `--json`（`{ users: [{ id, username, displayName, disabled, roles }] }`）；状态改为「启用 / 已禁用」并加表头。
- 导入日志带账号：同一 openid 挂在同一适配器的两个账号上时写成 `qq:<openid>（账号 <endpoint id>）`。
- `zhin agent info` 按来源统计：项目根目录的约定目录（`tools/`、`skills/`、`agents/*/tools` …）、本地插件（`plugins/`）与已安装的插件（`node_modules` 中带 `package.json#zhin` 清单的包，不再计入没有清单的包），报告新增 `source` 与 `bySource`；帮助为中英双语，输出按项目 `locale`（新增 `--locale`）显示中文或英文。`@zhin.js/agent` 的 `formatAgentSurfaceInfoReport()` 新增可选参数 `locale`，新增导出类型 `AgentSurfaceSource`、`AgentSurfaceCounts`。
- CLI 日期时间统一为本地时区的 `2026-11-15 00:15:56`（24 小时制），中英文相同：`zhin trace -l` / `--sessions` / 回合详情、`zhin schedule list`（下次运行与 `at`）、`zhin watch`（`at` 此前显示的是 UTC 时间）、`zhin doctor` 的「上次运行」、`zhin search` / `info` 的日期，以及 `zhin usage report` 的日期。`@zhin.js/plugin-runtime` 新增 `formatDateTime()` 与 `FormatDateTimeOptions`。
- `zhin trace -l` 的会话列显示与 `zhin usage report` 相同的可读名称加短键（如 `sandbox · 私聊 Developer（personal-session:ab12cd34）`）；`--json` 保留完整 `session_key` 并加上 `session_display_name`。`@zhin.js/agent/trace` 的 `formatTurnTraceList()` 新增可选参数 `{ sessionLabel }`（类型 `FormatTurnTraceListOptions`）；`@zhin.js/gateway/usage` 新增 `shortSessionKey()`、`sessionLabelOf()`。
