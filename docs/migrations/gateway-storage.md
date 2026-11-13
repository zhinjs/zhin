---
title: 升级：Console 账号移入 .zhin/gateway.db
description: Console 用户、角色、会话、API 令牌与审计从项目数据库移到网关自己的 .zhin/gateway.db：自动迁移、迁移完成前的 503、PostgreSQL / MySQL 的 SQL 控制台受限账号、备份与回退
---

# 升级：Console 账号移入 `.zhin/gateway.db`（ADR 0059）

Console 的用户、角色、角色绑定、会话、API 令牌与审计日志以前存在**项目数据库**的 6 张 `console_*` 表里；从本版本起，它们存在网关自己的 SQLite 文件 `.zhin/gateway.db`（[ADR 0059](../adr/0059-gateway-storage-isolation.md)），与项目数据库是哪种方言无关：

| | 以前 | 现在 |
| --- | --- | --- |
| Console 账号、会话、令牌、审计 | 项目数据库的 `console_*` 表 | `.zhin/gateway.db`（`0600`） |
| 谁能打开 | 网关与实例共用一个连接目标 | 只有网关（网关未运行时的 `zhin console …`；`--standalone` 开发模式） |
| redis / memory 项目 | 不能建 Console 账号 | 可以 |
| Console 的 SQL 控制台（PostgreSQL / MySQL） | 用主账号执行 | 只用受限账号执行（见下文第 3 节） |

插件数据、会话记录、功能覆盖等都还在项目数据库里，不受影响。

## 1. 自动迁移

升级后第一次 `zhin start` 时，网关在连接阶段：

1. 查项目数据库里是否有旧版的 6 张表（只查系统目录，不建表；SQLite 文件不存在、或项目用 redis / memory 时直接记为“无需迁移”）；
2. 把全部行导出到 `.zhin/backups/gateway-db-<时间>/console-tables.json`（`0600`）；
3. 在 gateway.db 的一个事务里复制，每张表按行数与校验和核对，一致才提交；
4. 再核对一次后，从项目数据库删除这 6 张表；
5. 在 gateway.db 的 `gateway_meta.legacy_import` 记下 `done`。

**迁移完成前 Console 登录不可用**：`/auth/login` 等返回 `503 iam_unavailable`，`/auth/me` 返回匿名并带 `unavailable` 原因，初始化令牌（`http.token`）也被拒绝——空的 gateway.db 不会被当成“还没有所有者”。常见原因是项目数据库暂时连不上，网关每 10 秒重试；`zhin logs` 可以看到 `gateway_legacy_import_failed`。SQLite 项目通常一秒内完成。

旧的密码、会话与 API 令牌在迁移后照常可用，不需要重新登录。

网关未运行时，`zhin console init` / `zhin console user …` 会先做同样的迁移；也可以手动执行：

```bash
zhin console migrate          # 迁移（网关运行时只显示状态）
zhin doctor                   # 「Console 账号存储」一项显示迁移状态
```

- 复制后、删除前旧表又被写过（旧版本还在运行），删除前的内容另外导出为同目录下的 `console-tables-changed.json`，gateway.db 保留复制时的数据，`zhin doctor` 会提示；
- 迁移之后项目数据库里又出现这些表（例如旧版本又跑了一次），新版本不会读取，`zhin doctor` 提示可以删除；
- gateway.db 里已有数据却没有迁移记录时，迁移拒绝合并并报错：检查 `.zhin/gateway.db`（必要时删除它再迁移）。

## 2. 部署：`.zhin/` 必须持久化

gateway.db 在 `.zhin/` 下。容器部署必须把 `.zhin/`（至少 `.zhin/gateway.db*` 与 `.zhin/keys/`）放在持久卷上，否则重建容器会丢失全部 Console 账号、会话、令牌与审计。

**备份**：所有方言都要备份 `.zhin/gateway.db`——`pg_dump` / `mysqldump` 里不再有 Console 账号。网关运行时请用 SQLite 在线备份（如 `sqlite3 .zhin/gateway.db ".backup gateway-backup.db"`），或停机后连同 `-wal` 文件一起复制。见[生产部署](../operations/production.md)。

## 3. PostgreSQL / MySQL：SQL 控制台的受限账号

Console 数据库页的 SQL 控制台（`db:query` / `db:execute`）现在只在**单独登录的受限账号**上执行；没有配置时它是关闭的（`capabilities.sql = false`，页面显示原因），数据浏览与结构编辑器不受影响。

```bash
zhin db console-role              # 用主账号建号，密码写入 .env，配置写入 database.console
zhin restart
```

配置里出现的是引用，密码只在 `.env`：

```yaml
database:
  dialect: pg
  # …主账号连接…
  console:
    user: ${ZHIN_DB_CONSOLE_USER}
    password: ${ZHIN_DB_CONSOLE_PASSWORD}
```

- 主账号没有建号权限（托管数据库常见）：`zhin db console-role --print-sql` 只打印 SQL（密码处是 `<ZHIN_DB_CONSOLE_PASSWORD>` 占位，真实值在 `.env`），交给 DBA 执行后 `zhin restart`；
- `zhin doctor --fix` 做同样的事；
- 实例启动时只**探测**这个账号（不是超级用户、不能建角色 / 库 / 模式、不属于其他角色、MySQL 上只有本库权限等），不合格时 SQL 控制台关闭并说明原因，之后最多每 5 分钟重新探测一次；PostgreSQL 上还会用主账号补授权给新建的表；
- **PostgreSQL 上 SQL 控制台不能做 DDL**（`CREATE` / `ALTER` / `DROP` 回 42501 权限不足）：请用 Console 的结构编辑器；
- SQLite 不需要受限账号：账号在另一个文件里，实例的连接拒绝 `ATTACH`。

## 4. 回退到旧版本

旧版本只认项目数据库里的表。降级前：

```bash
zhin stop
zhin console migrate --revert
```

它先把 gateway.db 复制到 `.zhin/backups/gateway-db-<时间>/`，再把 6 张表写回项目数据库并核对，然后清空 gateway.db 里的这些表。项目数据库里这些表已有数据时拒绝覆盖。之后可以安装旧版本；再次升级时会重新迁移。

## 5. 对集成与插件的影响

- 插件从来不能访问 `console_*` 表；现在它们根本不在项目数据库里。SQLite 上插件对原始句柄执行 `ATTACH` 会被拒绝，所在事务被回滚。
- `@zhin.js/gateway/iam` 删除了 `IAM_DIALECTS`；`installConsoleIam` 改为传 `projectDatabase`（`--standalone` 装配用）。`@zhin.js/core` 的 `createDatabaseHost` 不再有 `gatewayTableHost()`。
- 在网关运行时读 gateway.db 请用本地控制套接字（`zhin console …`），不要另开连接。
