---
title: 运维：实例、依赖与终端
description: Console 侧栏「运维」分组：实例状态、起停与日志，依赖安装与回滚，数据库 / 配置 / 环境变量 / 定时任务 / 文件，以及终端的安全须知
---

# 运维：实例、依赖与终端

侧栏「运维」分组回答「宿主机怎么样」。实例页、依赖安装和终端由管理网关提供（[ADR 0054](../adr/0054-management-gateway.md)），**实例崩溃、停止或正在安装依赖时照常可用**；数据库、配置、定时任务等页面读的是实例或项目文件。默认只有 `owner` / `admin` 看得到这个分组（`operator` 只有 `ops.schedule.read`）。

| 页面 | 路由 | 读 | 写 |
| --- | --- | --- | --- |
| 实例（含项目依赖） | `/ops/instance` | `status.view`；依赖列表 `feature.view` | 起停 `ops.restart`；依赖 `plugin.manage` |
| 数据库 | `/ops/database` | `ops.database.read`（浏览、排序、筛选、表结构） | 记录 `ops.database.write`；SQL 控制台与表结构 `ops.database.schema` |
| 配置文件 | `/ops/config` | `ops.config.read` | `ops.config.write` |
| 环境变量 | `/ops/env` | `ops.env.read`（只看打码值） | `ops.env.write`；「显示」原文需要 `ops.env.read` + `ops.env.write` |
| 定时任务 | `/ops/schedules` | `ops.schedule.read` | `ops.schedule.write` |
| 项目文件 | `/ops/files` | `ops.files.read` | `ops.files.write` |
| 终端 | `/ops/terminal` | `ops.terminal`（仅 `owner`） | — |

插件的安装、更新与卸载在侧栏「插件」分组（「插件」`/plugins`、「插件市场」`/marketplace`、插件详情 `/plugins/:name`），需要 `plugin.manage`，执行时同样走下文的[依赖事务](#packages)。

## 实例 {#instance}

「实例」页是**运行状态的唯一详情页**：首页和机器人状态只给摘要，进程与实例的完整状态都在这里。实例离线时本页仍由网关提供；页面顶部出现「实例不可用」横幅时，点「查看实例」就到这里（见[实例离线怎么办](./index.md#instance-offline)）。

- **运行状态**：`stopped`、`starting`、`running`、`stopping`、`backoff`（崩溃后等待重启）、`crashed`（一分钟内重启超过 10 次，停在「已崩溃」等人处理）；附进程 PID、已运行时长、近一分钟重启次数、启动时间、运行代次（`generation`）、上次退出与实例 ID。依赖事务进行中时，实例由事务停启。
- **最近一次失败**：时间、退出码与「失败前的日志」。按日志找到原因（常见：依赖未安装、配置缺少必填项、环境变量为空），修复后点「启动」；依赖问题可在「项目依赖」里重新安装。
- **操作**：启动、停止、重启（`gateway.instance.start|stop|restart`，需要 `ops.restart`，先确认）。停止后机器人离线，直到再次启动；重启时机器人短暂离线，正在进行的对话可能中断。重启只影响实例，网关与 Console 不中断；实例回到 `running` 前，依赖实例的页面返回 `503 instance_unavailable`，由横幅倒计时并自动重试。
- **实例日志**：网关采集的实例标准输出与标准错误（`gateway.instance.logs`，需要 `status.view`），实例离线时也能看；可「只看错误输出」、暂停或跟随最新。完整日志在服务器的 `.zhin/logs/instance.log`。
- **项目依赖**：`package.json` 里声明的依赖、声明的版本与已安装版本。「安装依赖」可填多个包（`name@版本范围`，空格或逗号分隔），可勾选安装后在配置中启用插件；每行可「更新」「卸载」，也可「全部更新」。非白名单的包只有所有者能安装。

同样的信息在命令行里是 `zhin status` 与 `zhin logs`，见 [zhin start](../cli/runtime.md#管理命令)。

### 依赖安装与回滚 {#packages}

下面这些入口安装、更新、卸载插件和依赖，都走网关的依赖事务（`gateway.packages.plan|install|uninstall|update`，需要 `plugin.manage`）：插件市场详情的「安装」、插件详情「版本与依赖」的「更新」「卸载」、实例页「项目依赖」，以及引导第 4 步。

1. 生成计划并校验白名单与配置修订号，备份 `package.json`、锁文件与配置；页面先展示计划，确认后才执行；
2. 停止实例；
3. 用项目的包管理器执行，输出实时推到 Console（事件流上的 `gateway.packages.progress`）；
4. 启动实例并等待就绪（默认 60 秒）；
5. 任何一步失败：恢复备份、重新安装、启动旧版本，并报告失败的阶段与日志尾部。

插件配置的 Schema 校验在实例启动之后才进行，校验失败按第 4 步失败处理并回滚。插件 Schema 里有没有默认值的必填字段时，安装结果显示「需要配置」，列出缺少的配置项与环境变量；按钮打开按 Schema 生成的配置表单，提交后网关写入插件声明并重启实例，失败回滚配置。

安装回执丢失（结果未知）时，页面只做只读核对，不会自动重放旧操作；见[操作回执](./index.md#receipts)。

## 数据库、配置、环境变量、定时任务、文件 {#ops-pages}

- **数据库**：浏览表、按条件查询、增删改行与 KV 存储，SQL 控制台与表结构调整见[下文](#database)。写操作直接作用于项目数据库，没有撤销。
- **配置文件**：按当前 YAML / JSON 格式查看与编辑 `zhin.config.yml`，保存带修订号，保存失败自动回滚。实例离线时由网关读写。某个插件的配置在它的全局配置页（`/features/global/:plugin`）用表单改，按层级的覆盖在对象页的「功能」页签。
- **环境变量**：`.env`、`.env.development`、`.env.production`。可能含机密，所以 `viewer` 没有 `ops.env.read`。
  - **默认打码**：页面（`env:get`）只拿到每个变量的打码值、长度和是否有值，从不拿到原文。值超过 8 个字符时只显示前 2 位与后 2 位（如 `sk●●●●●●●●ef`），8 个字符以内全部打码；不管变量名看起来是不是密钥，一律按这个规则打码。注释与空行保留在原位；被注释掉的赋值（`# KEY=...`）只显示变量名与打码值，既不是注释也不是赋值的行只显示长度。
  - **逐个显示**：每行的「显示」按钮调用 `env:reveal` 取回**这一个**变量在文件里的原文（含引号），需要同时持有 `ops.env.read` 与 `ops.env.write`（内置角色里只有 `owner` / `admin`），每次调用都写入[审计日志](./access-control.md#audit)（文件、变量名、主体；不记录值）。显示后可再隐藏，切换文件、保存或离开页面即清除。
  - **只保存改动的变量**：保存（`env:save { changes }`）只提交新增、修改或删除的变量；文件里其它行（包括从没显示过的密钥）按磁盘上的原样保留，不会被打码值覆盖。新值若是打码占位（含连续 3 个以上 `●`，或只由 `●` 组成）会被拒绝。整文件保存（`env:save { content }`）必须显式声明 `mode: "replace"`，内容里有打码占位同样被拒绝——旧版 Console 把看到的内容整份存回时因此会失败，并提示升级。
  - 旧版 Host（`env:get` 返回原文、没有 `env:reveal`）上，Console 按旧方式展示，并提示「当前 Host 版本会显示原文」。
- **定时任务**：打开时是「全部任务」总览，汇总每个任务的状态、下次运行、最近结果、目标与审批，可按状态筛选；创建、暂停和查看记录在各自的页签：「管理员任务」（`?tab=admin`，按用途创建管理员任务）、「定时提醒」（`?tab=schedule`，插件注册的任务与持久化任务）、「助手任务」（`?tab=assistant`）、「执行记录」（`?tab=history`）。
- **项目文件**：项目文件树与文本文件编辑，范围是插件源码与约定目录、`package.json` / `tsconfig.json`、配置文件、Agent 引导文件（`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md`）与知识库目录 `knowledge/`；读写配置文件仍需要 `ops.config.*`。**`.env` 与 `.env.*`（含 `.env.local`、`.env.production` 等）不出现在文件树里，也不能经项目文件读写**（任何大小写、`./`、`..`、URL 编码、尾部斜杠或空格、指向它们的符号链接都会被拒绝），请求会返回错误并提示改用「环境变量」页 `/ops/env`；环境变量在该页管理，权限仍是 `ops.env.read` / `ops.env.write`。

### 数据库 {#database}

「数据库」页按表浏览数据：服务端排序与筛选（筛选只接受表中存在的列与 `$eq`、`$ne`、`$gt`、`$gte`、`$lt`、`$lte`、`$like`、`$nlike`、`$in`、`$nin`），查看表结构并预览结构变更，需要 `ops.database.read`；增删改记录需要 `ops.database.write`。

**SQL 控制台**（只读查询与写 SQL）和**表结构调整**需要 `ops.database.schema`，内置角色中只有 `owner` 拥有。只读 SQL 也不对 `viewer` / `admin` 开放：按文本判断语句是否「只读」做不了安全边界（转义写法、动态 SQL 函数都能绕开），所以没有该权限的账号只用上面的结构化浏览；Console 会隐藏 SQL 页签并说明原因。

**SQL 控制台的前提**（[ADR 0059](../adr/0059-gateway-storage-isolation.md)）：Console 账号不在项目数据库里（在网关的 `.zhin/gateway.db`），SQL 控制台怎么写都读不到它们——这道边界由存储与数据库账号保证，下文的文本检查只是纵深防御：

- **SQLite**：无需额外设置。实例的连接拒绝 `ATTACH`，`ATTACH` 别的文件会被拒绝并回滚所在事务（能力里 `sqlIsolation: 'separate-store'`）。内存库不可用（见下文）。
- **PostgreSQL / MySQL**：SQL 控制台只用单独登录的受限账号执行（`sqlIsolation: 'restricted-credential'`）。没有配置 `database.console`、或启动时的权限探测不合格，SQL 页签显示原因、不能执行（数据浏览与表结构调整照常）。用 `zhin db console-role` 创建（无建号权限时 `--print-sql` 交给 DBA，或 `zhin doctor --fix`），然后 `zhin restart`，见[配置：`database.console`](../configuration/index.md#database-console)。
- **PostgreSQL 上 SQL 控制台不能做 DDL**：受限账号不拥有任何表、不能在 `public` 建对象，`CREATE` / `ALTER` / `DROP` 返回 42501（权限不足），Console 会提示改用表结构调整。MySQL 的受限账号有本库的建表 / 改表 / 删表权限，但没有触发器、存储过程、事件、`FILE` 与任何全局权限，且客户端拒绝 `LOAD DATA LOCAL`。

SQL 控制台的约束（对 `owner` 同样生效）：

- 每条语句都经单语句协议执行（PostgreSQL 扩展查询协议、MySQL 预处理语句、SQLite `prepare`），服务端不会执行藏在一条语句里的第二条；事务控制（`BEGIN`、`COMMIT`、`ROLLBACK`、`SAVEPOINT`、`SET`…）、`PREPARE` / `EXECUTE`、定义函数 / 过程 / 规则 / 扩展、改角色与服务端设置一律拒绝，所以「试运行」总能回滚。
- 只读查询在只读事务中执行，最多返回 1000 行（PostgreSQL 用游标、MySQL 流式读取、SQLite 逐行读取，只取保留的行），超时 10 秒（PostgreSQL `SET LOCAL statement_timeout`，不能用 `set_config` 解除；MySQL `max_execution_time`）。SQLite 文件库的只读查询在子进程里用只读连接执行，超时即强制结束，不阻塞实例；内存库无法这样隔离，SQL 控制台不可用。服务端读字符串的方式与默认不同时（PostgreSQL `standard_conforming_strings = off`，MySQL `sql_mode` 含 `NO_BACKSLASH_ESCAPES` 或 `ANSI_QUOTES`），SQL 控制台关闭并说明原因。
- （纵深防御）网关的 `console_*` 表名对所有人拒绝：按去掉引号、还原转义后的标识符与字面量比对；PostgreSQL `U&"…"` 转义写法、动态 SQL 与文件函数（`query_to_xml` 等 `*_to_xml*`、`xpath`、`ts_stat`、`dblink*`、`lo_*`、`pg_read_*`、`pg_ls_*`、`set_config`…）、MySQL 可执行注释 `/*! … */` 与优化器提示 `/*+ … */` 均被拒绝。表清单与表结构不列出 `console_*`；`sqlite_master`、`information_schema` 这类系统目录仍可查询，会看到 `console_*` 的表名与列名（看不到数据），这是已接受的限制；带有真实取值的统计视图（`pg_stats`、`pg_stats_ext*`、`pg_statistic*`、`sqlite_stat*`、MySQL `column_statistics`）以及角色密码哈希（`pg_authid`、`pg_shadow`、MySQL `mysql.*`）一律拒绝。
- 按名字保护看不到的批量或级联破坏一律拒绝：`DROP OWNED`、`REASSIGN OWNED`、建 / 改 / 删数据库与模式、`DROP … CASCADE`、`TRUNCATE … CASCADE`、`ALTER … OWNER TO`、表空间、用户与角色、MySQL `RESTART` / `CLONE` / `PURGE` 等；触发器与事件也不能在这里创建。
- 代码声明的表（插件 `define` 的表）不能在这里删列或改列名：插件读这些列，下次启动还会把它们加回来，应改插件里的表定义。MySQL 改列用 `MODIFY COLUMN` 重述整列，未改动的部分（完整类型、字符集与排序规则、`ON UPDATE`、`AUTO_INCREMENT`、注释、表达式默认值）取自 `information_schema`。
- 审计日志记录 SQL 文本与结构变更（含失败时尝试执行的 DDL），字符串字面量替换为 `'…'`、注释去掉，不记录结果行。

## 终端 {#terminal}

终端在浏览器里打开宿主机 Shell，或跳到白名单里的 SSH 目标（[ADR 0051](../adr/0051-console-terminal.md)）。它运行在网关里，实例崩溃时也能用。

::: danger 终端等于宿主机 Shell
终端以运行网关的系统用户身份执行任意命令，能读写该用户能访问的一切文件（包括 `.env`、数据库、私钥）。**持有所有者凭据就等于持有这台机器的 Shell。** 只在确实需要时开启，所有者账号用强密码，不要签发带 `ops.terminal` 的长期 API 令牌。
:::

### 开启

默认关闭，关闭时终端路由不注册（返回 404）：

```yaml
console:
  terminal:
    enabled: true
    shell: /bin/bash        # 省略时：$SHELL，Windows 为 powershell.exe
    cwd: .                  # 相对项目根
    idleTimeout: 900        # 秒，无输入即断开
    maxSessions: 4          # 同时会话上限
    ssh:
      - name: build-box
        host: 10.0.0.12
        port: 22
        username: deploy
        privateKeyPath: ~/.ssh/id_ed25519     # 或 privateKeyEnv / passwordEnv（+ passphraseEnv）
        hostFingerprint: SHA256:…             # 强烈建议填写
```

- 本地 Shell 需要可选依赖 `node-pty`，SSH 需要 `ssh2`；缺失时对应目标显示「不可用」与安装提示。
- SSH 凭据只来自本地密钥文件或环境变量，从不经过浏览器，也不出现在任何接口响应里。浏览器只能按 `name` 选择目标。

### 固定 SSH 主机指纹 {#ssh-fingerprint}

填了 `hostFingerprint` 时，网关严格比对目标主机公钥，不一致就拒绝连接；**不填时接受任何主机公钥**，中间人可以冒充目标拿到你的会话。部署前在一台可信的机器上取指纹：

```bash
ssh-keyscan -t ed25519 10.0.0.12 2>/dev/null | ssh-keygen -lf -
# 256 SHA256:AbCd… 10.0.0.12 (ED25519)
```

把 `SHA256:…` 那一段原样填进 `hostFingerprint`。目标主机重装或换钥后要同步更新。

### 使用与权限

1. 侧栏「运维 → 终端」（`/ops/terminal`）列出目标（`GET {base}/console/terminal/targets`）。
2. 选择目标后，Console 申请一次性票据（`POST {base}/console/terminal/tickets`，30 秒有效、绑定当前用户），再用它打开 WebSocket `{base}/console/terminal?ticket=…`。长期令牌不会出现在 URL 里。
3. 每个标签页一个会话；断开即结束会话，不做后台保活。

- 需要 `ops.terminal`，内置角色里只有 `owner` 持有；可以来自用户会话或用户 API 令牌，初始化令牌不行。
- 空闲超时、用户被禁用或改密、配置关闭终端时，服务端发送 `exit` 后关闭连接并结束进程。
- 审计日志记录会话开始（用户、目标、IP）与结束（时长、退出码、原因），不记录输入输出。
