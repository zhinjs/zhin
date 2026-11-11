---
"@zhin.js/gateway": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
"@zhin.js/database": patch
"@zhin.js/mcp": patch
"@zhin.js/a2a": patch
"zhin.js": patch
"@zhin.js/cli": patch
---

Console 访问控制迁到网关（ADR 0054 §3 / §7，B1.4）

- gateway：网关自己打开项目数据库（新子路径 `@zhin.js/gateway/database`，按实例同一规则解析 `database`；SQLite 为 WAL，网关连接遇忙时异步退避重试（5 秒，不使用同步 busy_timeout），超时返回 `503 database_busy` 与 Retry-After，写入都是单语句自动提交），持有 `console_*` 表，本地认证会话、API 令牌与初始化令牌；`{base}/auth/*`、`iam.*`、`onboarding.update`、初始化向导（切换数据库后网关重连并重启实例）、终端与审计都挂在网关上，没有实例时也能登录与初始化。数据库连接或重连期间按初始化标记失败即关闭。网关运行时另一个进程（`zhin console init`）创建了所有者，网关按初始化标记立即关闭开放 Host 并重读所有者状态，不再等 30 秒的定时刷新。网关接管 `{base}/events`（合并 `gateway.packages.progress`，实例离线时只含网关事件）与 `{base}/gateway/packages/progress`。
- host-http：桥接协议升到 3：删除过渡消息 `auth.*`；实例上报插件权限目录（`catalog`）与审计条目（`audit`），网关下发 `principal-revoked`，实例关闭该用户的 SSE 与 WebSocket。
- console-protocol：新增 `GATEWAY_PACKAGES_PROGRESS_PATH`，网关事件说明更新。
- database：SQLite 文件库总是开启 WAL，新增 `busyTimeoutMs`；未设置同步等待的连接（实例）对事务外语句与 `BEGIN IMMEDIATE` 遇到 `SQLITE_BUSY` 时做有界的异步退避重试（默认 5 秒，`busyRetryMs`），事务默认 `BEGIN IMMEDIATE`，声明 `readOnly` 的事务用 `BEGIN DEFERRED` + `query_only`，网关短暂持有写锁时实例写入不再报错。
- zhin.js：受监管实例不再安装 Console 账号与终端，只对网关转发的主体授权（`--standalone` 照旧自带）。
- mcp / a2a：配合实例不再持有 Console 令牌注册表。
- cli：`zhin console` 经网关模块打开项目数据库。
