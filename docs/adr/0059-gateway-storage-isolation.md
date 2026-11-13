---
sidebar: false
---

# ADR 0059：网关存储隔离——Console 账号放 `.zhin/gateway.db`，原始 SQL 不再靠文本检查守边界

状态：Accepted（2026-11-13）

关联：ADR 0049（Console 访问控制入库，含修订 2026-11-13「原始 SQL 只归 `ops.database.schema`」）、ADR 0054（管理网关，§7 数据）、ADR 0057（配置与状态存放：密钥放 `.env`、钥匙放 `.zhin/keys/`、`zhin backup`）、ADR 0058（无直接关系，编号相邻）。

## 背景

ADR 0049 / 0054 让网关和实例共用一个项目数据库：网关读写 6 张访问控制表（`console_users`、`console_roles`、`console_role_bindings`、`console_sessions`、`console_api_tokens`、`console_audit_log`，以 `IAM_TABLES` 为准；`console_conversations` 是实例表，不在其内），实例的插件、Agent 与 Console 数据库页用其余的表。实例这一侧“碰不到网关表”完全靠文本检查：

1. **Console 原始 SQL**（`db:query` / `db:execute`）：词法器、单语句协议、拒绝列表、`console_*` 名称守卫（ADR 0049 修订 2026-11-13）。
2. **插件原始句柄**：`getRawDatabase()` 的 `referencesGatewayOwnedTable` 文本守卫。
3. **模型 / 结构化浏览**：按表名拒绝（`assertInstanceTable`）。

独立评审已证明第 1 条绕得过去（`E'\''`、嵌套注释、`$a1$`、`U&"\0063onsole_users"`、`query_to_xml('select … from con' || 'sole_users', …)`）。修订之后拒绝列表更长，但根本问题没变：**同一个连接、同一个账号，能执行任意 SQL 的人就能读到口令哈希、会话与令牌哈希**。文本检查只能证明“我们想到的写法都拒绝了”。还有两条文本守卫覆盖不到的路：

- **SQLite `ATTACH`**：实例连接能 `ATTACH` 同目录下任何文件。Node 22 的 `node:sqlite` 没有 `setAuthorizer`，`limits: { attach: 0 }` 被忽略，`ATTACH` 在事务里也能成功（实测：Node 22.23）。
- **插件事务**：`transaction(trx => …)` 里的 `trx` 没经过文本守卫包装。

另外，账号表放在项目库里还带来：redis / memory 项目不能建 Console 账号（ADR 0049 §8）；网关常驻一个项目库连接；`pg_dump` / `mysqldump` 的备份里含账号与会话。

## 决策

### 1. 6 张访问控制表一律放进 `.zhin/gateway.db`

- 与项目库方言无关：`.zhin/gateway.db` 是 SQLite（WAL），文件权限 `0600`，`-wal` / `-shm` 同样 `0600`（先以 `0600` 建文件，SQLite 让 `-wal` / `-shm` 跟随主文件权限；打开后再校正一次）。另有 `gateway_meta` 表（`schema_version`、`legacy_import`）。
- **打开它的只有**：网关；网关未运行时的 `zhin console …`（以及 `zhin doctor`，只在文件已存在时）；`zhin start --standalone`（开发与测试：实例进程另开一个连接，不经 DatabaseHost，**没有进程隔离**，文档写明）。受网关监管的实例从不打开它。
- 网关不再常驻连接项目库，只在**迁移**（§3）和初始化向导**测试连接**时临时连接（ADR 0054 §7 修订）。
- IAM 不再受项目库方言限制：redis / memory 项目也能建 Console 账号，`IAM_DIALECTS` 删除（ADR 0049 §8 修订）。初始化向导的可选驱动只是“能测试连接的方言”（sqlite / mysql / pg / mongodb）。
- 数据库切换（初始化向导）：网关不必重连，只重启实例；账号留在 gateway.db。
- **威胁模型**：隔离针对的是 Console 原始 SQL、Agent 工具与插件的**无意**访问（以及经它们发起的提示注入 / 越权操作）。插件是受信任代码，与实例同进程、同系统用户运行，能直接读写项目目录下的文件——包括 `.zhin/gateway.db`；本 ADR 不把恶意插件挡在外面，部署时只安装可信插件。

### 2. SQLite 实例连接拒绝 `ATTACH`（`denyAttach`）

- `@zhin.js/database` 的 SQLite 方言新增选项 `denyAttach`（默认关；`tests/sqlite-json-columns.test.ts` 等仍要 `ATTACH`，所以不全局禁止）。实例的 `database` 配置在规范化时**强制开启**，配置里写 `denyAttach: false` 也无效。
- 每条原始语句——`query`、事务内的 `query` / `queryStatement`（含按行读取的路径）、Console 只读查询的隔离子进程——执行前后读 `PRAGMA database_list`，出现 `main` / `temp` 以外的库就拒绝（`SqliteAttachRefusedError`）。
- 在事务内发现：先 `ROLLBACK` 并把事务标记为 poisoned（之后的语句与 `COMMIT` 一律拒绝，调用方吞掉错误也没用），再 `DETACH`（事务内 `DETACH` 可能被拒，所以先回滚）。
- Node 提供 `setAuthorizer` 时额外装一个拒绝 `SQLITE_ATTACH` 的 authorizer；构造时传 `limits: { attach: 0 }`（新 Node 生效，Node 22 忽略）。都是特性检测，`database_list` 检查才是兜底。
- 方言新增 `backupTo(path)`（`node:sqlite` 的 `backup()`，没有时用 `VACUUM INTO`），产物 `0600`；回退迁移前用它给 gateway.db 留副本。实测：同一连接处在写事务中时 `backup()` 失败（“not an error”），所以在事务外做。
- SQLite 不需要受限账号：账号在另一个文件里，实例连接又打不开它。
- 插件拿到的原始句柄（`getRawDatabase()`）不是 registry 本身，而是一个显式的门面对象：只有 registry 的方法（`query`、`transaction`、`model`、`select` / `insert` / `update` / `delete` 等）和原始类型字段（`dialectName`、`isStarted`）；`models` 是只读的 Map 视图，`get`、`values()`、`entries()`、`forEach`、迭代拿到的都是同样的门面；方法返回的模型、查询构造器、事务上下文以及回调收到的参数也都包成门面。任何门面上都没有 `dialect`、`database`、`config`、`db` 之类的字段，门面对象被冻结，不能赋值、不能替换方法（测试要观察调用时 spy 的是 `host.db`，门面在调用时才去 registry 上取方法）。`denyAttach` 在 SQLite 方言构造时存入私有字段 `#denyAttach`，之后改 `config` 无效；连接是私有字段 `#db`。这是防误用，不是对抗受信任插件的沙箱（见 §1 威胁模型）。

### 3. 迁移：网关连接阶段把旧表导入 gateway.db

迁移由同一个函数（`importLegacyIamTables`）完成：网关在连接阶段执行；网关未运行时 `zhin console …` 执行；`--standalone` 由实例执行。`gateway_meta.legacy_import` 记录状态：无记录（未决定）→ `fresh`（无需迁移）| `copied`（已复制，旧表未删）→ `done`。

- **判定**：已是 `done` / `fresh` 直接跳过（不读项目库配置，项目库配置写错也不影响登录）。redis / memory → `fresh`。SQLite 项目库文件不存在 → `fresh`（不为此创建文件）。否则临时连项目库，**不定义任何表**，从系统目录查 6 张表（`sqlite_master` / `to_regclass` / `information_schema.TABLES` / `listCollections`），都不在 → `fresh`；连不上 → 什么都不写。
- **迁移完成前 IAM 一律关闭**：`ConsoleIamService` 有 `unavailable` 原因时视为“已初始化”（初始化令牌被拒），任何会话 / 令牌都不认证，`/auth/*` 回 503 `iam_unavailable`（`/auth/me` 仍回匿名、`setupRequired: false` 并带 `unavailable` 原因）。空的 gateway.db 绝不当作“还没有所有者”。网关按 `retryMs`（默认 10 秒）重试。
- **备份**：复制前把 6 表全部行导出到 `.zhin/backups/gateway-db-<时间>/console-tables.json`（目录 `0700`，文件 `0600`，不覆盖已有文件）。
- **复制**：gateway.db 上 `BEGIN IMMEDIATE`（同时是网关 / CLI 之间的互斥锁）；目标必须为空（非空又没有记录 → 报错，不合并）；源端在只读可重复读快照内按 `id` 分批 500 行读取；列取目标定义与源行的交集；每表记录行数与校验和——按 `id` 排序（码元序）的规范化 JSON 的 SHA-256，`integer` / `bigint` 统一成十进制字符串，`null` 保持——写入后在同一事务内重读复算，一致才在同一事务写 `copied { counts, checksums, columns, source, backup }`；任何一步失败整体回滚。
- **删除旧表**：再读一次源端并算校验和。一致则删（SQLite / PostgreSQL 一个事务；MySQL / MongoDB 逐张，中断后续删）；不一致说明复制后旧表又被写过（旧版本还在跑），另外导出 `console-tables-changed.json`，照删并告警（`zhin doctor` 报告），gateway.db 保留复制时的数据。写 `done`。处于 `copied` 时从删除这一步继续。
- **之后**：项目库里再出现这些表，不读；`zhin doctor` 警告。PostgreSQL 的授权刷新（§4）撤销受限账号在这些表上的一切权限。
- **回退**：`zhin console migrate --revert`（降级前必须执行，网关须已停止）：先用 `backupTo` 给 gateway.db 留副本并导出 `gateway-tables.json`，把 6 表写回项目库（项目库里这些表有数据则拒绝），重读校验，再清空 gateway.db 的 6 表并删除 `legacy_import` 记录。再次升级时重新迁移。

### 4. PostgreSQL / MySQL：Console 原始 SQL 只用受限账号

- Console 原始 SQL（`db:query` / `db:execute`）在**受限账号的独立连接池**上执行（懒创建，`pool.max = 2`）；数据浏览、`describe`、结构编辑器（`db:schema:*`）、发现物理表仍用主连接。
- **配置**：`database.console: { user: ${ZHIN_DB_CONSOLE_USER}, password: ${ZHIN_DB_CONSOLE_PASSWORD} }`（密码只在 `.env`，ADR 0057）；交给主连接驱动前剥离。两个变量都未设置时视为没有受限账号（原始 SQL 关闭、其余照常），只设一个或与 `database.user` 相同是配置错误。其他方言忽略这个块。
- **`zhin db console-role [--print-sql] [--role <名>]`**（与 `zhin doctor --fix` 同一动作，`setupConsoleRole`）：用主账号建号、随机 32 字节密码（base64url）写 `.env`、经配置事务写入 `database.console` 引用；主账号没有建号权限时 `--print-sql` 打印给 DBA 的语句（密码以 `<ZHIN_DB_CONSOLE_PASSWORD>` 占位，真实值只在 `.env`），同样写入 `.env` 与配置。项目库里还有旧账号表时拒绝（先完成 §3 的迁移：MySQL 的库级授权会覆盖它们）。**实例启动时不会悄悄建号**，只做探针与（PostgreSQL）幂等补授权。
- **PostgreSQL 角色** `zhin_console_<项目根路径 SHA-256 前 8 位>`：`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4`，不属于任何角色；`CONNECT` 本库；`public` 只 `USAGE`、显式 `REVOKE CREATE`；`public` 下现有表与视图 `SELECT, INSERT, UPDATE, DELETE, TRUNCATE`（逐表授予，`console_*` 网关表除外），序列 `USAGE, SELECT, UPDATE`；`ALTER DEFAULT PRIVILEGES FOR ROLE <主账号> IN SCHEMA public` 同样授予；角色级 `statement_timeout = 60s`、`search_path = public`。PostgreSQL ≤ 14 时 `PUBLIC` 默认可在 `public` 建对象：provision 先 `GRANT CREATE ON SCHEMA public TO <主账号>` 再 `REVOKE CREATE ON SCHEMA public FROM PUBLIC`。已有角色时改为 `ALTER ROLE`（轮换密码）；主账号不是超级用户时不写 `SUPERUSER` / `REPLICATION` / `BYPASSRLS`，没有 `CREATEDB` 时不写 `CREATEDB`（PG 16 实测：`CREATEROLE` 账号连 `NO…` 也不能写），由探针检查属性。
- **PostgreSQL 原始 SQL 不做 DDL**：受限账号不拥有任何表、不能在 `public` 建对象（防止 CVE-2018-1058 一类为主账号预埋同名函数 / 表的反向提权）；`CREATE` / `ALTER` / `DROP` 回 42501，Console 提示改用结构编辑器。`SET [LOCAL] ROLE` 不是边界（`RESET ROLE`、`set_config('role', …)` 就能回去），所以必须是**单独登录**的连接。
- **MySQL 账号** `'zhin_console_<哈希>'@'<主账号 CURRENT_USER() 的主机部分>'`，`MAX_USER_CONNECTIONS 4`；先 `REVOKE ALL PRIVILEGES, GRANT OPTION` 回到已知状态，再在 `` `<库>`.* ``（`_` / `%` 转义，避免通配）授予 `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW, CREATE TEMPORARY TABLES`；不给 `TRIGGER`、`CREATE ROUTINE` / `ALTER ROUTINE`、`EXECUTE`、`EVENT`、`LOCK TABLES`、`GRANT OPTION` 与任何全局权限（`FILE` 等）。受限连接关闭 `LOCAL_FILES`（mysql2 `flags: ['-LOCAL_FILES']`，不配 `infileStreamFactory`）与 `multipleStatements`。
- **探针**（启动时；失败后最多每 5 分钟重试一次，下一次原始 SQL 请求触发）：
  - PostgreSQL：`current_user` / `session_user` 等于配置的用户且不是主账号；不能执行其他角色拥有的 SECURITY DEFINER 函数（`pg_catalog` / `information_schema` 之外，扩展函数也算，按 `has_function_privilege(current_user, p.oid, 'EXECUTE')`；它们以属主权限运行）——PUBLIC 默认可执行函数，建号不替用户撤销，原因文字提示 `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC` 或改为显式授予，具体函数名（最多 5 个）只写日志；非超级用户，无 `CREATEROLE` / `CREATEDB` / `BYPASSRLS` / `REPLICATION`；`has_schema_privilege(current_user, 'public', 'CREATE') = false`；`has_database_privilege(current_user, current_database(), 'CREATE') = false`；不是任何角色的成员；`pg_has_role(current_user, <主账号>, 'USAGE') = false`。探针前用主账号做一次幂等补授权（`refreshConsoleGrants`：给新出现的实例表授权，撤销残留 `console_*` 表上的一切权限）。
  - MySQL：`CURRENT_USER()` 用户部分等于配置的用户；`USER_PRIVILEGES` 只有 `USAGE`；`SCHEMA_PRIVILEGES` 只在本库、不含禁止权限、没有 `IS_GRANTABLE = YES`；其他库没有表级权限；`CURRENT_ROLE()` 为 `NONE`（5.7 / MariaDB 没有这个函数时跳过）。
  - 不满足 → 原始 SQL 停用并给出原因。文本兼容检查（`standard_conforming_strings`、`sql_mode`）改在受限连接上做。
- **能力上报**：`capabilities.sqlIsolation` 为 `separate-store`（SQLite）或 `restricted-credential`（PostgreSQL / MySQL）；没有可用受限账号时 `sql: false`，`sqlReason`（同时写入原有的 `reason`）说明原因并指引 `zhin db console-role`。**不提供用主账号执行原始 SQL 的选项。**
- 测试可经 `createDatabaseHost(config, { textGuard: false })` 关掉 Console 的文本检查，证明边界只靠存储与账号也成立（不是配置项）。

### 5. 文本检查保留，作为纵深防御

前缀守卫（`assertInstanceTable`）、Console SQL 词法器、单语句协议与拒绝列表、插件文本守卫（`referencesGatewayOwnedTable`）、审计脱敏全部保留，不再承担隔离：即使其中一条被绕过，SQLite 上读到的是 `no such table` / `ATTACH` 被拒，PostgreSQL / MySQL 上是 42P01 / 42501 / 1146 / 1142。

### 6. 备份

- 所有方言都要备份 `.zhin/gateway.db`（含 `-wal`，或用在线备份）：`pg_dump` / `mysqldump` 不再含账号。`zhin backup`（ADR 0057 第 5 步，尚未实现）落地时必须包含它。
- 部署文档写明 `.zhin/` 必须持久化（容器卷）：丢了 gateway.db 就丢了全部 Console 账号、会话、令牌与审计。

### 7. Agent 文件策略

`.zhin/` 整体已在 Agent 文件工具的拒绝目录里，`*.db` 及其 `-wal` / `-shm` 也按文件名拒绝（ADR 0054 §7 以来），覆盖 `.zhin/gateway.db*` 与 `.zhin/keys/`。`bash` 另按命令文本拒绝：命令里出现 `.zhin` 路径、`gateway.db`、`zhin/keys`，或带通配符的 `gateway…` / `*.db`（`tar cf - .zhin`、`cp -r .zhin`、`cd .zhin && cat …`、`find … -name "gateway*" -exec cat`、脚本字符串里的路径）。另外拒绝：以 `.` 开头、带通配符且字面前缀可能展开成 `.zhin` 的路径分量（`.z*`、`.zh?n`、`.[z]hin`、`.*`、`.{zhin,…}`），能匹配 `.zhin`、`gateway.db`（含 `-wal` / `-shm`）或 `keys` 的通配词与 `find -name` / `-path` 模式（`gat*`、`*.db`、`*zh*`），去掉引号后再比对（`.zh""in/gateway.d""b`），以及网关表名（`console_users` 等 6 张与 `zhin_gateway_store`）。比对前先按 shell 的读法展开：`$'…'`（ANSI-C 引用，`$'\x2e'zhin`、`$'\056zhin'`、`\u`）解码，简单花括号列表与字符范围（`{.,x}zhin`、`{-../}zhin`，可嵌套）展开，任一展开结果命中即拒绝；展开结果超过 4096 个词时直接拒绝。这是文本检查：运行时才得出的路径（`$var`、`$(…)`、逐字符拼接文件名、`find . -type f -exec cat {} +` 这类整树读取）看不到，它只缩小提示注入后 Agent 用 `bash` 能做的事，不是沙箱。隔离执行（Docker 沙箱）里，项目的 `.zhin/` 在每种模式下都被一个空的只读 tmpfs 盖住——可写回合与只读回合（工作区整体 `:ro` 挂载）都一样——容器内看不到 gateway.db 与钥匙。Agent 的 `bash` 工具固定 `useDocker: 'always'`：没有 Docker 时拒绝执行，不回退到宿主。直接使用 `Sandbox` 且 `useDocker: 'auto'`（默认）的调用方在没有 Docker 时回退到宿主执行（软沙箱：只有 ulimit 与进程组），那里没有挂载边界，`.zhin/` 可读，进程内首次回退时记一条警告日志；没有容器的 `danger-full-access` 模式同样没有这层。真正的边界仍是 §1 的文件权限与“实例不打开 gateway.db”。

### 8. 版本

`@zhin.js/database`、`@zhin.js/gateway`、`@zhin.js/core`、`zhin.js`、`@zhin.js/cli` 发 minor（所有者已批准，记在 `.changeset/version-policy.json` 的 `approvedNonPatchReleases`）；其余受影响的包 patch。

## 迁移

用户可见的步骤见 [`docs/migrations/gateway-storage.md`](../migrations/gateway-storage.md)：

1. 升级后第一次 `zhin start`：网关自动迁移；完成前 Console 登录返回 503。SQLite 项目通常在一秒内完成。
2. PostgreSQL / MySQL：运行 `zhin db console-role`（或 `zhin doctor --fix`；没有建号权限用 `--print-sql`），再 `zhin restart`，Console 的 SQL 控制台才可用。数据浏览与结构编辑器不受影响。
3. 部署确保 `.zhin/` 持久化；备份加上 `.zhin/gateway.db`。
4. 降级前：`zhin stop` 后 `zhin console migrate --revert`。

## 兼容

- `console_*` 表名、字段、`ConsoleIamService` 行为不变，只是换了库；`/auth/*`、`iam.*` 协议不变，只多了 503 `iam_unavailable` 与 `/auth/me` 的 `unavailable` 字段。
- 公共 API 变化：`@zhin.js/gateway/iam` 删除 `IAM_DIALECTS`，`defineConsoleIamTables` 不再返回布尔值，`installConsoleIam` 改为 `{ projectDatabase, openStore? }` 且没有 `supported`、`dispose()` 返回 Promise；`@zhin.js/gateway/database` 新增 `openGatewayStore` / `setupConsoleRole` 等，`GatewayConsole.database()` 返回 gateway store；`@zhin.js/core` 的 `createDatabaseHost` 删除 `gatewayTableHost()`，新增第二个参数；`@zhin.js/database` 新增 `denyAttach`、`backupTo`、`console-credential` 一组函数与 MongoDB `listCollections` 操作；`DatabaseHostConsoleCapabilities` 新增 `sqlReason`、`sqlIsolation`。
- 本地控制套接字新增 `gateway.console.migration.status`（`zhin console migrate` / `zhin doctor` 在网关运行时读迁移状态，不再自己打开 gateway.db）。
- 旧版 Console 前端只认 `reason`：`sqlReason` 同时写进 `reason`，旧前端也能看到原因。

## 备选（未采用）

### A. 留在项目库，用 `REVOKE` 把网关表从实例账号收走

网关用一个账号、实例用另一个账号，同一个库里对实例账号 `REVOKE` 6 张表。未采用：

- SQLite 没有账号，文件谁能打开谁就能读全部表——最常见的部署恰恰没有边界。
- 要求每个 PostgreSQL / MySQL 部署都有两个账号且由我们管理授权，托管数据库常常不给 `CREATEROLE` / `CREATE USER`；做不到时只能退回文本检查。
- 实例账号仍需在同库建表（插件迁移），PostgreSQL 上与网关账号的 `search_path` 交互又回到 CVE-2018-1058 一类问题。
- redis / memory 项目依旧不能有账号。

### B. 独立 schema / 独立库（同一服务器）

PostgreSQL 放到 `zhin_gateway` schema、MySQL 放到另一个库，并只授权给网关账号。未采用：

- 同样需要两个账号与 DBA 配合，SQLite 依旧无解；
- 备份、迁移、恢复变成每个方言各一套；
- 网关仍然常驻连接业务数据库服务器，数据库不可用时 Console 无法登录。

`.zhin/gateway.db` 对所有方言一样，网关只依赖本地文件；受限账号只用来约束“能执行任意 SQL 的那条路”，不需要它时（SQLite）也不缺边界。

## 待定

- **Web 初始化向导里一键建受限账号**：目前向导保存 PostgreSQL / MySQL 时只提示 `zhin db console-role`（`SETUP_CONSOLE_ROLE_NOTICE`）；在 Web 上用主账号建号需要把主账号密码再交给网关一次，暂不做。
- **`zhin backup`**（ADR 0057 第 5 步）：实现时包含 gateway.db（`backupTo`）。
- **需要实测**（本地无法覆盖）：MySQL 5.7 / 8.x / MariaDB 的 `CURRENT_USER()` 主机部分、`SCHEMA_PRIVILEGES` 的转义写法、mysql2 `-LOCAL_FILES` 在各版本的效果、受限账号经预处理协议执行 DDL；PostgreSQL 托管服务（RDS、Cloud SQL 等）的 `CREATEROLE` 限制与 `pg_hba`、PostgreSQL ≤ 14 的 `public` CREATE；MongoDB 旧集合迁移；Node 22.19 上 `node:sqlite` 的 `backup()`；Windows 上 gateway.db 的权限（不做 `chmod`）。
- **`--standalone` 的进程隔离**：开发与测试路径，实例进程同时持有 gateway.db 连接；不打算补。

## 实施顺序

一个 PR 完成：

1. `@zhin.js/database`：`denyAttach`、`backupTo`、`console-credential`（`consoleRoleStatements` / `planConsoleRole` / `provisionConsoleRole` / `probeConsoleCredential` / `refreshConsoleGrants`）、MongoDB `listCollections`；
2. `@zhin.js/gateway`：`openGatewayStore`、`importLegacyIamTables` / `revertLegacyIamImport` / `inspectLegacyIamImport`、`ProjectDatabase` 的 `tableExists` / `readSnapshot` / `dropTables` / `query` / `transaction`、网关连接阶段改造、`IAM_DIALECTS` 删除、`unavailable` 语义、`setupConsoleRole`、`gateway.console.migration.status`；
3. `@zhin.js/core`：`database.console`、SQLite 强制 `denyAttach`、受限账号连接池与探针 / 补授权、`sqlReason` / `sqlIsolation`、删除 `gatewayTableHost()`；`@zhin.js/plugin-runtime` 能力类型；
4. `zhin.js/instance`：`--standalone` 改用 gateway store；
5. `@zhin.js/cli`：`zhin console migrate [--revert]`、`zhin db console-role`、`zhin doctor` 10e；
6. Console 前端：`sql = false` 时显示 `sqlReason`，PostgreSQL 写 SQL 遇 42501 提示改用结构编辑器；
7. 文档与修订：ADR 0049 / 0054 / 0057、`docs/migrations/gateway-storage.md`、配置参考、生产部署、Console 运维。

## 修订 2026-11-13：独立评审后的加固

独立评审（同日）发现的问题与处理：

1. **gateway.db 丢失会重新打开初始化**（原 §3 判定 `fresh('no-tables')`）：迁移完成（`done`）或判定无需迁移（`fresh`）后，网关在项目库写入标记表 `zhin_gateway_store`（`id = 'gateway'`、`store_id`、`migrated_at`；MongoDB 为同名集合），`store_id` 是 gateway.db 打开时生成的随机 id（`gateway_meta.store_id`）。之后每次连接：gateway.db 是新的 / 空的而项目库有标记 → `store_lost`；gateway.db 已就绪但标记里是别的 store → `store_mismatch`。两者都让 Console 访问控制保持关闭（初始化令牌被拒），原因说明恢复备份或运行 **`zhin console init --reset-store`**（需先 `zhin stop`、需确认或 `--yes`）：重置把标记改写为当前 store、记 `fresh` / `reset-store`、并在新 store 的审计日志写一条 `auth.store.reset`（含原 store id），然后继续初始化。项目库连不上时不阻止已就绪的 store（它本身没有丢）。SQLite 项目库文件尚不存在时不为标记创建它，下次启动补写。标记表与 `console_*` 一样属网关所有（`isGatewayOwnedTable`）：实例、Console 与受限账号都碰不到。**redis / memory 项目没有地方写标记**：`.zhin/` 必须持久化，否则丢失 gateway.db 会回到“没有所有者”。`--revert` 删除标记。
2. **重复失败时每 10 秒写一份完整备份**：备份目录按快照内容命名（`.zhin/backups/gateway-db-legacy-<内容摘要>`），同样的行只写一次。失败分两类：项目库不可用 / 忙为暂时性，网关按 `retryMs × 2ⁿ` 退避重试（上限 5 分钟）；`conflict`、`mismatch`、`invalid`（旧表缺 `id` 列）、`store_lost`、`store_mismatch` 需要运维处理，不再自动重试，写入 `gateway_meta.legacy_import_failure`，`zhin doctor` 报告（网关运行时经 `gateway.console.migration.status` 读取，带 `pendingCode`），处理后重启网关。
3. **PostgreSQL 连接串（M1）**：受限连接由 `consoleConnectionOptions`（`@zhin.js/database`）构造：主账号的 `user` / `password` 字段、连接串的用户信息与 `?user=` / `?password=` / `?options=` 查询参数全部去掉，受限账号以查询参数写入（`pg-connection-string` 会用连接串里的值覆盖显式字段，空值也算）。MySQL `uri` 拆成 `host` / `port` / `database`，只保留 `charset`、`timezone`、`connectTimeout`、`ssl` 等白名单参数——`?multipleStatements=true`、`?flags=LOCAL_FILES` 会盖过假值字段，一律丢弃；连接后读驱动合并后的配置（`connectionSafety()`），仍有 `LOCAL_FILES` 或多语句时拒绝使用。连接池 `resetSession`：PostgreSQL 归还前 `DISCARD ALL`，MySQL `connection.reset()`（COM_RESET_CONNECTION），重置失败的连接直接销毁。
4. **PostgreSQL 探针补 CVE-2018-1058 前提（L1）与角色设置（L5）**：受限账号在任一非临时模式上有 `CREATE`、拥有任何模式 / 表 / 函数 / 类型 / 运算符、角色级设置（`pg_db_role_setting`）不等于 `search_path=public`、`statement_timeout=60s`，或能访问任何网关表（`console_*`、`zhin_gateway_store`）时，探针不通过。账号自己可以 `ALTER ROLE CURRENT_USER SET …` / 改密码（PostgreSQL 允许），所以建号时先 `ALTER ROLE … RESET ALL` 再写入预期设置，探针逐项比对。成功的探针 60 秒后过期：之后的原始 SQL、以及受限连接上出过错之后的第一次使用，都先重新补授权并探测（在已开的连接上进行）；失败后最多每 5 分钟重试。部署时还应在 `pg_hba.conf` / MySQL 账号主机部分把受限账号限制为实例所在主机。
5. **回退后默认权限（L2）**：`--revert` 把账号表写回项目库后，主账号的默认权限会把这些新表授予受限账号（MySQL 是库级授权）：回退时撤销受限账号在 6 张表上的权限，PostgreSQL 撤销 `ALTER DEFAULT PRIVILEGES` 授予，MySQL 撤销该账号的全部授权，并提示删除账号与 `database.console`。正常运行时每次补授权都撤销网关表上的授权，探针也检查。
6. **MySQL 角色与 PROXY（L3）**：探针拒绝 `information_schema.APPLICABLE_ROLES` 非空（8.0.19 前 / MariaDB 解析 `SHOW GRANTS` 的角色授予行）、`PROXY` 授权、以及本库之外或允许集合之外的 `TABLE_PRIVILEGES` / `COLUMN_PRIVILEGES`；建号时按 `SHOW GRANTS FOR` 撤销遗留的角色与 PROXY。MySQL < 5.7.6 / MariaDB < 10.1.3 不支持 `CREATE USER IF NOT EXISTS` / `ALTER USER`，建号直接报版本过低。
7. **匿名响应泄露细节（L6）**：IAM 关闭期间，`/auth/me` 与 503 回复只给通用说明和类别码（`unavailableCode` / `reason`：`starting`、`store`、`migration_pending`、`migration_failed`、`store_lost`、`store_mismatch`），路径与驱动报错只写日志、只给本机所有者（`zhin doctor`、`zhin console migrate`）。
8. **建号的密码（L7）**：PostgreSQL 发送客户端算好的 SCRAM-SHA-256 校验值（`PASSWORD 'SCRAM-SHA-256$4096:…'`），口令本身不经网络、不进服务器日志，`--print-sql` 可原样交给 DBA；MySQL 的语句用占位符。任何错误信息里出现的口令（原样、转义、URL 编码）都替换为 `[redacted]`，驱动原始错误不再作为 `cause` 带出。
9. **插件原始句柄（L8）**：见 §2 最后一条；威胁模型写入 §1。
10. **SECURITY DEFINER 函数（评审补充，所有者决定）**：PostgreSQL 探针在受限账号能执行属主不是它自己的 SECURITY DEFINER 函数时拒绝（`pg_catalog` / `information_schema` 之外，扩展函数也算），`sqlReasonCode` 为 `console-role-invalid`；`sqlReason` 只给通用说明与改法（`REVOKE EXECUTE ON FUNCTION … FROM PUBLIC` 或显式授予），函数名（`schema.name`，最多 5 个）只进日志。建号不撤销 PUBLIC 的 EXECUTE（会改变其他用户的访问），`zhin db console-role --print-sql` 附注释提示如何检查与撤销。
11. **Console 前端（L9）**：`capabilities.sqlReasonCode` 区分 `console-role-missing` / `console-role-invalid` / `text-compatibility` / `sqlite-isolation`，只有前两种提示运行 `zhin db console-role`；PostgreSQL 的 42501 提示按方言 id 判断。
12. **Agent `bash`**：见 §7，按命令文本补拒绝间接读取的写法，并说明其局限。

### 第三轮评审（同日）

13. **首次运行的 SQLite 项目没有标记**：实例在网关首次连接之后才创建项目库文件，原来判定 `fresh('no-database-file')` 后不写标记，之后丢失 gateway.db 会重新开放初始化。现在网关为写标记直接创建 SQLite 项目库文件（与实例相同的路径，父目录一并创建，权限同实例新建时），并在首个所有者创建后、以及受监管实例第一次进入运行状态时再检查一次标记（缺了就补写）。
14. **插件原始句柄**：Proxy 可经 `models.values()` / `forEach` / 迭代、查询构造器的 `dialect` / `database` 字段、以及替换方法后以真实对象为 `this` 执行而绕过；改为 §2 所述的显式门面，`denyAttach` 改为构造时捕获的私有字段。
15. **Agent `bash` 通配符**：见 §7 的通配与 `find` 模式规则；Docker 沙箱里 `.zhin/` 改为隐藏（空只读 tmpfs），不再只是只读挂载。
16. **标记表与探针补充**：PostgreSQL 上网关建标记表后立即撤销 PUBLIC 与所有被授予者（含受限账号）的权限；MySQL 的受限账号是库级授权，做不到按表撤销，那里只有 Console 文本检查与启动探针（`console_*` / 标记表名）挡着，这一点如实记下。探针新增：能执行服务器文件 / 远程函数（`pg_ls_*`、`pg_read_file`、`pg_read_binary_file`、`pg_stat_file`、服务端 `lo_import` / `lo_export`、adminpack `pg_file_*`、`dblink*`）、对网关表有任何列级权限（`has_any_column_privilege`）、拥有大对象、能使用 `public` 以外模式的表时拒绝。数据库级的 `search_path` 设置被受限账号的角色级设置覆盖，不影响它；PUBLIC 默认的 `TEMPORARY` 只产生本会话可见的临时对象（`pg_temp` 中的函数不会被隐式解析），两者不拒绝。
17. **错误分类**：只有本模块自己判定的失败（`conflict`、`mismatch`、`invalid`、`store_lost`、`store_mismatch`）是永久的；驱动报的任何错误（连接中断、语句或锁超时、序列化失败、死锁、连接数满、MongoDB 网络错误……）都按暂时性处理并退避重试。复制时的唯一键冲突也是驱动报的错，同样按暂时性处理（第 2 条早先把它列为 `invalid`，已更正，见第 4 轮）。
18. **其他**：受限连接还去掉 `password1` / `password2` / `password3` / `passwordSha1`；受限连接出错触发的重新探测至少间隔 30 秒；`--reset-store` 在当前 gateway.db 已有账号时提示“只改标记、不删账号”；MariaDB 的角色授予（不带 `@host`）也被识别并撤销。托管 PostgreSQL 若装有 PUBLIC 可执行的 SECURITY DEFINER 扩展函数（或 dblink 等），在撤销之前原始 SQL 一直关闭——这是有意的，见迁移指南。

### 第四轮评审（同日）

19. **只读回合也隐藏 `.zhin/`**：此前 tmpfs 覆盖只在可写回合生效，只读回合把整个项目 `:ro` 挂进容器，`find . -type f -exec cat {} +` 能读到 gateway.db。现在每种模式都加隐藏覆盖（只读回合只加 `tmpfs-dir` 一类，其余只读覆盖对 `:ro` 挂载无意义）。`useDocker: 'auto'` 无 Docker 时的宿主回退见 §7，并记警告日志。
20. **插件原始句柄的文本检查不再按方法名**：此前只有 `query` 的第一个字符串参数做网关表名检查，`trx.queryStatement('delete from zhin_gateway_store')` 能执行。现在原始句柄与事务句柄的每个方法、每个参数（含数组与普通对象里的字符串、`$raw` 条件、`new String(…)`、自带 `toString` / `valueOf` / `Symbol.toPrimitive` 的对象）都检查；类字符串对象只转换一次，检查过的原始字符串就是交给驱动的值。代价：参数数据里字面出现网关表名（如插入一条内容为 `console_users` 的消息）也会被拒绝（失败即关闭）。
21. **live 测试各用独立数据库**：PostgreSQL / MySQL 的 live 套件各自创建并删除一个数据库（PostgreSQL 由主账号创建，需 `CREATEDB`；MySQL 由 root 创建并授予主账号），套件建的角色在删库后删除；full-validation 去掉 `--no-file-parallelism`。MySQL 8 在预处理语句协议下对 `CREATE TRIGGER` / `CREATE PROCEDURE` 先报 1295（不支持），测试同时接受 1295 与权限错误，并直接核对受限账号没有 `TRIGGER` / `CREATE ROUTINE` / `FILE` 权限。
22. **其他**：网关运行中的标记检查（建首个所有者后、实例首次就绪时）发现 `store_mismatch` / `store_lost` 时，Console 进入与连接时相同的关闭状态（不重试，`zhin doctor` 与 `gateway.console.migration.status` 报告），不再只记日志；修订第 2 条更正：复制时的唯一键冲突是驱动报的错，按暂时性处理，`invalid` 只指旧表缺 `id` 列；Agent `bash` 文本检查按 shell 读法解码 `$'…'` 并展开花括号（§7）。
