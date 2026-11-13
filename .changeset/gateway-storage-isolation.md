---
"@zhin.js/database": minor
"@zhin.js/gateway": minor
"@zhin.js/core": minor
"zhin.js": minor
"@zhin.js/cli": minor
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/agent": patch
"@zhin.js/host-http": patch
---

网关存储隔离（ADR 0059）：

- Console 的用户、角色、绑定、会话、API 令牌与审计从项目数据库移到网关自己的 `.zhin/gateway.db`（SQLite，`0600`），与项目库方言无关；redis / memory 项目也能建 Console 账号（删除 `IAM_DIALECTS`）。网关不再常驻连接项目库。
- 升级后网关在连接阶段自动迁移旧表：备份为 `.zhin/backups/gateway-db-<时间>/console-tables.json`，在 gateway.db 事务内复制并按行数与校验和核对，再从项目库删除；完成前 `/auth/*` 回 503 `iam_unavailable`，初始化令牌被拒。`zhin console migrate [--revert]` 手动迁移与降级前回退。
- `@zhin.js/database`：SQLite 方言 `denyAttach`（事务内发现 `ATTACH` 回滚并作废事务、再 `DETACH`）与 `backupTo`；`console-credential`：受限账号的建号语句、`planConsoleRole` / `provisionConsoleRole` / `probeConsoleCredential` / `refreshConsoleGrants`；MongoDB `listCollections` 操作。
- `@zhin.js/core`：实例 SQLite 连接强制 `denyAttach`；PostgreSQL / MySQL 的 Console 原始 SQL 只在 `database.console` 受限账号的独立连接池上执行（启动探针、PostgreSQL 补授权、失败后最多每 5 分钟重试），没有可用账号时 `capabilities.sql = false` 并给出 `sqlReason`；新增 `capabilities.sqlIsolation`；删除 `gatewayTableHost()`。
- `@zhin.js/cli`：新增 `zhin db console-role [--print-sql] [--role]`、`zhin console migrate [--revert]`；`zhin console …` 网关未运行时打开 gateway.db；`zhin doctor` 检查 gateway.db 权限、迁移状态、项目库里重新出现的旧表与受限账号（`--fix` 建号）。
- `zhin.js/instance`：`--standalone` 的 Console 访问控制改用 gateway.db（不经 DatabaseHost）。
- `@zhin.js/plugin-runtime`：`DatabaseHostConsoleCapabilities` 新增 `sqlReason`、`sqlIsolation`。`@zhin.js/runtime`：主机配置 Schema 新增 `database.console`（`password` 标为密钥）。`@zhin.js/agent`：补测试固定 Agent 文件 / bash 工具拒绝 `.zhin/gateway.db*` 与 `.zhin/keys/`。
- `@zhin.js/host-http`：Console 数据库 RPC 的驱动错误回复带上 SQLSTATE（`data.sqlState`，如受限账号的 42501），Console 据此提示改用结构编辑器。
