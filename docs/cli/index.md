---
title: "CLI 参考"
description: "zhin 命令行的全部子命令：启动与停止、配置向导、插件安装与发布、诊断、给运行中的 Bot 发消息、定时任务与系统服务"
---

# CLI 参考

日常和 Zhin 打交道，基本就是和 `zhin` 这一个命令打交道：启动 Bot、改配置、装插件、诊断问题。它由 `@zhin.js/cli` 提供，项目里通过 `npx zhin …` 或 `pnpm exec zhin …` 调用。从零新建项目用的是另一个命令 `npm create zhin-app`。

```bash
npx zhin --help        # 查看全部命令
```

::: tip 在 Bot 项目外运行
项目里装了 `@zhin.js/cli`，`npx zhin` 直接用它。在项目外（例如新建独立插件、在插件目录发布），npx 会去 npm 下载名为 `zhin` 的包：

- 从 `zhin@4.0` 起，npm 上的 `zhin` 就是 `@zhin.js/cli` 的别名，`npx zhin <命令>` 与 `npx @zhin.js/cli <命令>` 完全相同。
- `zhin@3.x` 是早已停止维护的旧版框架包，不是这个 CLI。npx 缓存里还留着 3.x、或项目锁在 `zhin@^3` 时会运行到它，表现为命令不存在或启动报错。此时改用 `npx @zhin.js/cli`（任何版本都可靠），或用 `npx zhin@latest` 强制取新版。
:::

## 最常用的命令

| 我想…… | 命令 |
| --- | --- |
| 启动 Bot（开发模式，改代码自动热重载） | `pnpm dev`（即 `zhin start --foreground --watch source config`） |
| 在服务器上后台运行 / 查看 / 停止 | `npx zhin start` / `npx zhin status`、`npx zhin logs -f` / `npx zhin stop` |
| 由 systemd / Docker / PM2 托管（前台） | `pnpm start`（即 `zhin start --foreground --mode production --no-watch`） |
| 首次创建 Console 所有者 | `npx zhin console init`（或用启动时打印的链接在 Console 里完成） |
| 增加 Console 账号、重置密码 | `npx zhin console user create <用户名> --role viewer` / `npx zhin console user passwd <用户名>` |
| 接入平台、配置 AI 或数据库 | `npx zhin setup`（可加 `--adapters` / `--ai` / `--database`） |
| 环境或配置有问题 | `npx zhin doctor` |
| 检查配置文件是否有效 | `npx zhin config check` |
| 安装一个社区插件 | `npx zhin install <插件名>` |
| 临时停用 / 重新启用一个插件（不卸载） | `npx zhin disable <instanceKey>` / `npx zhin enable <instanceKey>` |
| 按功能查找插件和配置步骤 | `npx zhin use-cases` |
| 创建一个可独立发布的新插件 | `npx @zhin.js/cli new my-plugin --standalone` |
| 发布前检查插件 | `npx @zhin.js/cli plugin check` |
| 在插件里新增命令、中间件、工具等文件 | `npx zhin create command hello` |
| 在已有 Bot 项目里加一个本地插件 | `npx zhin new my-plugin` |
| 更新依赖（停实例 → 安装 → 启实例，失败回滚） | `npx zhin update` |
| 升级 Zhin | `npx zhin migrate --dry-run`，确认后去掉 `--dry-run` |
| 安装为开机自启的系统服务 | `npx zhin service install` |

下面按用途分组列出全部命令。

## 运行

### start / stop / restart / status / logs：网关与实例

```bash
zhin start [--foreground] [--mode development|test|production] [--environment <name>]
           [--watch source config | --no-watch] [--once] [--open] [--log-file <path>] [--standalone]
zhin stop [--timeout <ms>]
zhin restart [--gateway]
zhin status [--json]
zhin logs [-f] [-n <1-1000>] [--interval <ms>]
```

`zhin start` 启动管理网关（常驻，承载 HTTP 与 Console）并由它拉起 Zhin 实例；默认后台运行，`--foreground`（`-f`）前台运行（开发、systemd、容器、PM2）。只有 `--foreground`、`--once`、`--standalone` 会前台运行：单写 `--mode production` 仍在后台，进程管理器里必须带 `--foreground`。网关在运行时，其余命令经本地控制套接字 `.zhin/gateway.sock` 请求网关：`stop` 停止实例与网关，`restart` 只重启实例（`--gateway` 重启后台网关），`status` 显示两者状态（未运行时退出码 3），`logs` 读取实例日志。网关未运行时 `stop` / `restart` 无事可做，`logs` 读取 `.zhin/logs/instance.log`。管理命令必须以启动网关的同一个系统用户运行。选项、退出码与 systemd 示例见 [zhin start](./runtime.md)。

`zhin update` 见下文[更新依赖](#update-更新依赖)。

### runtime：项目工具

```bash
zhin runtime start [...]    # 前台运行网关，等同于 zhin start --foreground
zhin runtime inspect
zhin runtime codegen [dir] [--write] [--json]
zhin runtime build
zhin runtime publish [--execute|--resume] [--tag latest]
zhin runtime migrate [extract|cutover|verify|status] [--check|--write]
```

`--watch` 与兼容参数 `--no-watch` 互斥；都不传时不监听文件变化。

| 子命令 | 作用 |
| --- | --- |
| `start` | 前台运行网关与实例（`zhin start --foreground` 的别名），详见 [zhin start](./runtime.md) |
| `inspect` | 输出项目结构 JSON（插件清单、构建计划） |
| `codegen` | 扫描约定目录，输出插件能力的静态类型声明与 `capabilityGraph` 摘要；`--write` 写入目标目录的 `plugin.capabilities.d.ts`，`--json` 输出扫描结果。`dir` 默认当前目录 |
| `build` / `publish` | 按项目结构构建、发布。`publish` 默认只打印计划，加 `--execute` 才执行，中断后可 `--resume` |
| `migrate` | 生成并应用项目结构迁移计划：`--check` 只看计划，`--write` 原子写入，`status` 输出就绪报告 |

脚手架生成的项目里已有这些惯例脚本：

```json
{
  "scripts": {
    "dev": "zhin start --foreground --watch source config",
    "start": "zhin start --foreground --mode production --no-watch",
    "stop": "zhin stop"
  }
}
```

### service：系统服务

```bash
zhin service install [--user]
zhin service uninstall [--user]
zhin service status [--user]
```

安装开机自启 / 守护服务。`--user` 在 Linux 下使用用户级 systemd；`status` 仅支持 Linux 和 macOS。服务文件以前台方式运行网关（`zhin start --foreground --mode production --no-watch`），实例由网关监管重启。

### db：Console SQL 的受限账号 {#db}

```bash
zhin db console-role [--print-sql] [--role <账号名>]
```

PostgreSQL / MySQL 上，Console 的 SQL 控制台只用单独登录的受限账号执行（[ADR 0059](../adr/0059-gateway-storage-isolation.md)）。这条命令用主账号创建它（默认名 `zhin_console_<项目哈希>`），随机密码写进 `.env`（`ZHIN_DB_CONSOLE_USER` / `ZHIN_DB_CONSOLE_PASSWORD`），配置写入 `database.console` 的 `${…}` 引用；再运行时轮换密码。主账号没有建号权限时加 `--print-sql`：不建号，只打印 SQL 交给 DBA（密码位置是 `<ZHIN_DB_CONSOLE_PASSWORD>` 占位，真实值在 `.env`）。项目数据库里还有旧版 Console 账号表时拒绝，先完成迁移。完成后 `zhin restart`。`zhin doctor --fix` 做同样的事。SQLite 不需要。见[配置：`database.console`](../configuration/index.md#database-console)。

### console：初始化与用户管理 {#console}

```bash
zhin console init [--status] [--reset-store]
zhin console init [--database sqlite|mysql|pg|mongodb] [--database-<字段> <值> ...]
                  [--database-password-env <VAR> | --database-password-stdin]
                  [--owner <用户名>] [--display-name <显示名>] [--password-stdin] [-y]
zhin console user create <用户名> [--role viewer] [--display-name <显示名>] [--password-stdin]
zhin console user passwd <用户名> [--password-stdin]
zhin console user disable <用户名>
zhin console user enable <用户名>
zhin console user list
zhin console migrate [--revert]
```

Console 的用户、角色、会话、API 令牌与审计存在网关自己的 `.zhin/gateway.db` 里（[ADR 0049](../adr/0049-console-rbac.md)、[ADR 0059](../adr/0059-gateway-storage-isolation.md)），不在项目数据库里。这组命令与 Console 网页上的初始化向导、「访问控制」页做同一件事，适合在服务器上、容器构建里或忘记密码时使用。

- **经由谁执行**：项目的网关在运行时，命令经本地控制套接字 `.zhin/gateway.sock` 交给网关处理（连上即视为本机所有者），切换数据库、创建所有者立即生效；网关未运行时直接打开 `.zhin/gateway.db`（离线初始化与救援），先把旧版留在项目数据库里的账号表迁过来。套接字存在但属于其他系统用户或无响应时报错，不会绕过网关改文件。
- **`init`**：两步——选择数据库（默认保留当前配置，通常是 SQLite），再创建第一个所有者。不带参数时交互提问；`--status` 只输出初始化状态（JSON）。已经有所有者时报错退出，请改用 `zhin console user`。
  - `--database <dialect>` 换数据库，连接字段用 `--database-filename`、`--database-host`、`--database-port`、`--database-user`、`--database-database`、`--database-url`、`--database-db-name`、`--database-mode` 等传入；CLI 先测试连接，成功后写入配置，机密字段写进 `.env`。
  - 数据库密码有两种推荐方式（三种来源只能选一个）：`--database-password-env <VAR>` 引用已有环境变量（配置里写入 `${VAR}`）；`--database-password-stdin` 从标准输入第一行读取，写进 `.env`，配置里写 `${VAR}`。同时用 `--password-stdin` 时，第一行是数据库密码、第二行是所有者密码。
  - `--database-password <值>` 仍可用但**不推荐**：机密会留在 shell 历史与进程列表（`ps`）里，命令执行时会打印警告。
  - `--owner` 加 `--password-stdin` 可非交互创建所有者（密码取标准输入第一行，与 `--database-password-stdin` 同用时取第二行；至少 10 位）；加 `-y` 时缺少参数直接失败而不提问，适合脚本。
- **`user`**：`create` 默认绑定全局 `viewer`，`--role` 可指定 `owner` / `admin` / `operator` / `viewer` 或自定义角色；`passwd` 重置密码并吊销该用户的全部会话；`disable` / `enable` 禁用与恢复；`list` 列出用户、状态和角色绑定。适配器 / 账号作用域的绑定在 Console「访问控制」里设置。
- **`init --reset-store`**：`.zhin/gateway.db` 丢失或被替换（项目数据库的标记 `zhin_gateway_store` 指向另一个 store）时 Console 保持关闭；确认放弃原有账号后用它重置（需先 `zhin stop`，会要求确认，`--yes` 跳过），重置记入新的审计日志，然后继续初始化。
- **`migrate`**：把旧版存在项目数据库里的 Console 账号表迁入 `.zhin/gateway.db`（网关启动时也会自动执行；网关运行时只显示状态）。`--revert` 写回项目数据库并清空 gateway.db，降级到旧版本之前必须执行，需先 `zhin stop`。见[升级说明](../migrations/gateway-storage.md)。
- `http.token` 只是**初始化令牌**：所有者创建之前有效，之后在所有接口上失效。

```bash
# 容器或服务器上的非交互初始化：先创建所有者，再开放端口
printf '%s\n' "$OWNER_PASSWORD" | zhin console init -y --owner admin --password-stdin
printf '%s\n' "$VIEWER_PASSWORD" | zhin console user create alice --role viewer --password-stdin
# 换 PostgreSQL：数据库密码在第一行、所有者密码在第二行，都不出现在命令行上
printf '%s\n%s\n' "$PG_PASSWORD" "$OWNER_PASSWORD" | zhin console init -y --database pg \
  --database-host db --database-user zhin --database-database zhin \
  --database-password-stdin --owner admin --password-stdin
```

成功时退出码为 `0`，失败（已初始化、用户不存在、数据库连接失败、参数缺失等）为 `1`。

## 配置与诊断

### setup：交互式配置向导

```bash
zhin setup                 # 完整向导
zhin setup --database      # 仅配置数据库
zhin setup --adapters      # 仅配置适配器（添加账号）
zhin setup --ai            # 仅配置 AI
zhin setup -y --adapter sandbox --enable-ai --install   # 非交互：只执行参数指定的步骤
zhin setup --decisions     # 可选的 TypeSafe Jev 决策服务（需要已有 AI 配置）
zhin setup --bootstrap     # 仅生成引导文件（SOUL.md / TOOLS.md / AGENTS.md）
zhin setup --global        # 在 ~/.zhin 初始化全局实例
zhin setup --locale en     # 设置项目语言（zh-CN 或 en），可与其他选项组合
```

向导修改的就是 [`zhin.config.yml`](../configuration/index.md) 中对应的部分，密钥写入 `.env`。非交互参数：`--adapter <name>`（可重复）添加适配器，`--enable-ai` 启用 AI（模型服务之后在 Console 添加），`--skip-ai` / `--skip-adapters` 跳过对应引导步骤，`--install` 立即安装所需依赖（与 Console 相同的白名单），`-y` 不提问、只执行参数指定的步骤。

不传 `--locale` 时保留项目已有的语言；语言与时区相互独立，详见[语言与本地化](../configuration/localization.md)。

选择网络数据库时，CLI 会检查端口范围，把连接字段写成环境变量引用，实际值写入 `.env`。完成后运行 `npx zhin config check`，可以在启动前发现缺失的数据库变量；如果连接值只在 `.env.production` 里，使用 `npx zhin config check --environment production`。

### config：读写配置

```bash
zhin config list                       # 完整配置（敏感值打码）
zhin config get <key>                  # 点路径 ai.enabled 或 JSON Pointer /plugin/key.with.dot
zhin config set <key> <value>          # value 按 JSON 解析，失败时作为字符串
zhin config unset <key>                # 别名 delete / del
zhin config path                       # 显示本地配置文件路径
zhin config check [--fix] [--json] [--strict]
```

`get` / `set` / `unset` / `list` **默认连接运行中的 Host**（`POST {base}/console/request`）：写入先读取配置版本，再用 `config:patch-project` 一次性提交，由 Host 完成 CAS、Schema 校验、保存和按需生效。CLI 不自己读改写文件，也不重试。

- 连接：`--host <url>` 优先，token 只取 `ZHIN_CONSOLE_TOKEN`（或 `--token-env <name>` 指定的变量）。未给 `--host` 时按配置 `http.host` / `http.port` / `http.base` 推导地址（监听地址 `0.0.0.0` / `::` 会改连 `127.0.0.1` / `[::1]`），此时环境变量未设置才回退到配置 `http.token`。非 loopback 地址携带 token 必须用 HTTPS。
- **Host 未运行时直接失败，不会回退到离线写文件。** 需要离线操作时显式加 `--offline`：用与 Host 相同的 `patchProject` 规则（版本检查、插件声明不可改、逐段 Schema 校验）在本地校验后保存；不启动 Runtime、不执行插件 `setup`、CLI 不向 Host 发送任何请求，但加载插件声明时会执行模块顶层代码（模块自身可能访问网络）。离线保存不会让运行中的 Host 生效，需要 `--watch config` 或在 Console 中「应用配置」。
- 读取默认按 Schema 打码：`secret` / `writeOnly` / `hidden` / 密码字段、密钥类键名以及未展开的 `${...}` / `env://` 引用都显示为 `[redacted]`；加 `--reveal` 才输出原值。
- `get` / `list` / `set` / `unset` 加 `--json` 时只输出一行紧凑 JSON，便于脚本处理；不加时只输出可读文本（`config path`、`config check` 的输出格式见各自说明）。
- 退出码 `6` 时会同时输出 `requestId` 与 `expectedRevision`（`--json` 在结果对象中，否则打印到 stderr），用于核对这次写入。

退出码是公开契约：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功：已保存并生效（或无需生效）；读取成功；`--offline` 已保存（尚未在运行中的 Host 生效） |
| `3` | 已保存，部分配置需重启进程后生效 |
| `4` | 版本冲突：配置已被其他地方修改，未保存；输出最新值（已打码；Schema 无法证明安全的分支，如 `if`/`not`/`contains`、嵌套 `$id`、非本地 `$ref`，整体打码） |
| `5` | 校验失败（含插件声明写入被拒）：未保存时输出字段路径；配置已保存但生效前校验失败时也返回 `5`，请用 `zhin config get` 核对 |
| `6` | 结果未知：写请求已发出但未收到确定回执（含网关 502/504 等非权威错误），或已保存但生效结果未确认。附带 `requestId` / `expectedRevision`；请先 `zhin config get` 核对，**不要直接重试** |
| `7` | 未连接到运行中的 Host：请求未发出，文件未修改 |
| `1` | 其他错误：参数错误、配置项不存在、鉴权失败（401/403）、Host 明确拒绝请求（未保存）；或**已保存但未生效**（被更新修订替代、部分配置生效失败/受阻，文件已写入） |

`config check` 校验配置文件，`--fix` 自动修复可以安全迁移的字段。数据库连接变量缺失本身就是错误；其他警告可以用 `--strict` 提升为错误，适合在 CI 中使用。

### doctor：环境诊断

```bash
zhin doctor [--fix] [--upgrade-l4]
zhin doctor --live <host-url> [--json]
```

检查 Node、端口、Token、配置等环境问题；`--fix` 自动修复能修复的项；`--upgrade-l4` 诊断从最小项目升级到完整 AI 栈需要补什么。`--live` 读取运行中 Host 的就绪报告（需要 `ZHIN_CONSOLE_TOKEN` 里带 `status.view` 的 API 令牌，自定义 `http.base` 写进 URL 路径），`--json` 输出 JSON；就绪时退出码 `0`，否则 `1`，见[生产部署与运维](../operations/production.md#_2-网络与鉴权)。`--fix` 补写依赖时使用与 CLI 同一次发布的真实版本范围（如 `^1.1.11`），不写 `latest`；写入后运行 `pnpm install`。

### dev：联调本地 zhin 源码与独立插件

```bash
zhin dev link <zhin 源码路径> [--project <dir>] [--no-install]
zhin dev unlink [--project <dir>] [--no-install] [--force]
zhin dev link <插件目录> [--project <dir>] [--as <实例名>]
zhin dev unlink <实例名> [--project <dir>]
```

`<插件目录>` 的 `package.json` 有 `zhin` 字段时，把独立插件接进当前 bot：在 `plugins/` 建链接、写入 `./plugins/<实例名>`，并让插件的 `@zhin.js/*` 使用 bot 的同一份，改插件源码即热重载，见[独立插件热重载联调](/authoring/local-dev#dev-link-plugin)。

传 zhin 源码路径时，在外部插件项目里把 `zhin.js` / `@zhin.js/*` 整体切换到本地源码（打包完整依赖闭包并写入 `pnpm.overrides`，保证每个包只有一份实例），`unlink` 原样恢复。`doctor` 的「Zhin 包单实例」检查会发现多份实例并提示该命令。详见[本地联调指南](/authoring/local-dev)。

### onboard：项目引导

```bash
zhin onboard [--quick] [--flow quickstart|full]
```

在已有项目里复用现有配置、环境变量和数据，选择保留或重新配置。`--quick`（`-q`）只显示快速开始提示，不进入向导；`--flow` 默认 `full`，`quickstart` 问得更少。

### migrate：项目升级

```bash
zhin migrate [--dry-run] [--no-install] [--include-pinned]
```

把旧版本 Zhin 项目升级到最新：依赖、scripts 与目录结构。`--dry-run` 只打印计划，结束时提示“nothing was changed”；`--no-install` 跳过最后的 `pnpm install`。精确版本（如 `1.1.6`）、`link:`、`file:` 等用户锁定的依赖默认保留，`--include-pinned` 才会一并改为 `latest`。完整升级流程见 [版本兼容与迁移](../operations/upgrades.md)。

项目目录（有 `zhin.config.*`）里，`zhin start` 在生产环境也要用 CLI 和管理网关，所以 `zhin migrate` 把 `zhin.js`、`@zhin.js/cli`、`@zhin.js/gateway` 一起放进 `dependencies`：只写在 `devDependencies` 的连同版本挪过去，两处都有时删掉 `devDependencies` 里的重复项，缺 `@zhin.js/gateway` 就补上（CLI 是 `latest` 等标签时用同一标签，否则用与当前 CLI 同批发布的版本范围）。`--prod` 安装因此不会丢掉启动所需的包。插件包（没有项目配置）的 CLI 仍留在 `devDependencies`。`zhin runtime migrate` 的 cutover 对私有（项目）包做同样的调整。

`zhin migrate` 不改配置文件。启动报 `configVersion must be 2` 或 `zhin doctor` / `zhin config check` 提示 v1 配置时，使用下文的 `zhin migrate instances`。`zhin runtime migrate` 是旧插件能力代码迁移，与配置版本无关。

#### migrate inference：迁移旧 AI 模型配置

```bash
zhin migrate inference [--mapping <file>] --output migration.json     # 离线预览
zhin migrate inference --apply migration.json --maintenance --backup-confirmed [--with-credentials]
zhin migrate inference --finalize migration.json --maintenance --backup-confirmed
zhin migrate inference --sessions-only --mapping <file> --output <file>   # 只把旧 Session 绑定到现有 Profile
```

离线预览并迁移旧的 `ai.providers` 等模型配置与 Session，不加载 `.env`，也不启动 Bot。`--apply` 与 `--finalize` 必须同时带 `--maintenance`（确认 Bot 已停止）和 `--backup-confirmed`（确认已备份配置、数据库与加密主密钥）；非 SQLite 数据库用 `--state-snapshot <file>` 提供旧元数据，`--database-config <file>` 提供离线数据库连接。完整步骤与恢复边界见[Provider 接口升级](../ai/provider-upgrade.md)。

## 插件

### new：创建插件

```bash
zhin new [plugin-name] [--standalone] [--type normal|service|adapter] [--package-name <npm 包名>] [--is-official] [--skip-install]
```

**这是创建插件的唯一官方入口。** 插件名须匹配 `/^[a-z][a-z0-9-]*$/`；不传参数时进入交互式问答。

- **独立插件（要发布到 npm 的外部插件）**：`npx @zhin.js/cli new my-plugin --standalone`，在当前目录下生成 `./my-plugin/`，不需要事先有 Bot 项目，也不会修改任何 `package.json`。生成物包含 `package.json#zhin` 清单、默认导出 `definePlugin()` 的 `plugin.ts`、约定目录、`tests/`、`README.md`，开箱可 `pnpm test` / `pnpm typecheck` / `pnpm publish`。
- **项目内本地插件**：在 Bot 项目根执行 `zhin new my-plugin`（不加 `--standalone`），生成到 `plugins/<name>/` 并把它加进根 `package.json` 的 `dependencies`。

- 包名默认是 `zhin.js-<name>`；也可以用 `--package-name` 指定自己的名字或 scope（如 `@me/zhin-plugin-x`）。`@zhin.js/` 作用域只留给官方插件（`--is-official`）。
- `zhin.js` 与能力包（`@zhin.js/command`、`@zhin.js/skill` 等）写成 peerDependencies，版本是从已安装版本推导出的 `^x.y.z`；同样的版本也写进 devDependencies，供本地测试和类型检查使用。
- 构建产物按[发布包目录规范](../contributing/publishing.md#发布包目录规范)组织：
  - `src/` 是库代码，`pnpm build` 把它编译到 `lib/`（`.js` + `.d.ts`），`main`、`types`、`exports` 都指向 `lib/`。
  - `zhin.entry` 是 `./plugin.js`，本地运行时会自动回退到 `plugin.ts`。打包（`pnpm pack` / 发布）时，`prepack` 先运行 build，再用 `scripts/build-runtime-entries.mjs` 把 `plugin.ts` 和约定目录编译成同目录的 `.js`，其中对 `src/` 的导入会改写到 `lib/`；`postpack` 再把这些生成文件清掉。
  - `files` 是白名单，只发布 `lib/`、`plugin.js`、约定目录里的 `.js`、`schema.json`、`skills/`、`agents/` 和文档，不发布 `.ts` 源码、测试和配置。

  见 [definePlugin · 开发入口与 npm 发布入口](../authoring/define-plugin.md#开发入口与-npm-发布入口)。
- 生成的 `pnpm test`（Vitest）和 `pnpm typecheck`（`tsc --noEmit`）直接可用，不需要设置 `NODE_ENV`。
- `--skip-install` 同时跳过插件目录和项目根的 `pnpm install`。

### create：生成约定目录文件 {#create}

```bash
zhin create <command|middleware|handler|tool|component> <name> [--cwd <插件目录>] [--force] [--event <事件>]
```

在当前插件包里生成一个能力文件，省去手写约定目录与 `package.json#zhin` 清单。插件包是从当前目录向上找到的第一个 `package.json`，它必须带 `zhin.type: "plugin"` 清单（`zhin new` 生成的插件、Bot 项目根都满足）；`--cwd` 指定别的起点。

| 类型 | 生成文件 | 默认导出 | Feature 包 |
| --- | --- | --- | --- |
| `command` | `commands/<path>/index.ts` | `defineCommand`（`zhin.js/command`） | `@zhin.js/command` |
| `middleware` | `middlewares/<name>/index.ts` | `defineMiddleware`（`zhin.js/middleware`） | `@zhin.js/middleware` |
| `handler` | `handlers/<path>/index.ts` | `defineHandler`（`zhin.js/handler`） | `@zhin.js/handler` |
| `tool` | `tools/<name>/index.ts` | `defineAgentTool`（`@zhin.js/tool`） | `@zhin.js/tool` |
| `component` | `components/<name>/index.tsx` | `defineComponent`（`zhin.js/component`） | `@zhin.js/component` |

```bash
zhin create command gh/issue                         # commands/gh/issue/index.ts → /gh issue
zhin create command echo/[text]                      # 末段 [text] 是必填参数，模板里已声明 params.text
zhin create handler message/receive                  # 事件由路径推断：message.receive
zhin create handler welcome --event notice.receive   # 路径不是内置事件时用 --event 指定
zhin create tool lookup
```

- 名称每段需匹配 `/^[a-z][a-z0-9-]*$/`。`command` 与 `handler` 可以用 `/` 分段；`command` 的最后一段可以是必填参数目录 `[name]`（`[[name]]`、`[...name]` 请手动创建，见[命令](../authoring/commands.md)）。
- 模板是能通过类型检查的最小默认导出，按需修改即可。
- `package.json`：`zhin.features` 里没有对应 Feature 包时追加 `{ package, api }`；插件还没有依赖它时，按 `zhin new` 的规则写进 `peerDependencies`（`optional`）和 `devDependencies`，版本跟随插件自己的 `zhin.js` 写法（`workspace:` 仍用 workspace 链接，否则用发布版本 `^x.y.z`）。已有的条目不会重复添加，其余字段与格式（2 空格缩进、末尾换行）保持不变。依赖有变化时会提示运行 `pnpm install`。
- 目标文件已存在时报错退出（退出码 1），加 `--force` 覆盖。
- `zhin add <包名>` 是 `zhin install` 的旧写法，仍可用（会提示改用 `zhin install`）；创建插件用 `zhin new`。

### install：安装插件

```bash
zhin install <插件名或 git 地址> [--no-enable] [--dry-run]
```

默认会用 pnpm 安装，再把包引用写进 `zhin.config.yml` 的 `plugins.<instanceKey>`；业务参数写在顶层同名实例块，启停由 `disable_plugins` 控制（用 [`zhin enable` / `zhin disable`](#enable-disable) 修改）。插件 Schema 有无默认值的必填字段（例如适配器的 `endpoints` 账号）时，只安装依赖、不写声明，并提示缺少的配置项：在 Console 填写后声明（`gateway.plugins.declare`），或运行 `zhin setup --adapters`，或手动在配置文件中添加 `plugins.<instanceKey>` 与实例块后重启。

| 选项 | 说明 |
| --- | --- |
| `-D, --save-dev` | 写入 `devDependencies` |
| `-g, --global` | 全局安装（不启用插件） |
| `--no-enable` | 只装依赖，不改配置 |
| `--dry-run` | 打印将执行的安装和配置改动，不实际写入 |

网关在运行时（`zhin start`），安装经网关的依赖事务执行：先停止实例，运行包管理器，再启动实例并等待就绪；失败时恢复 `package.json`、锁文件与配置并重新启动旧版本。进度实时输出到终端。经网关只能安装 npm 注册表包（`name` 或 `name@范围`）；git 地址、本地路径与 `--save-dev` 需先 `zhin stop`。网关未运行时直接在项目里执行。

### uninstall：卸载

```bash
zhin uninstall plugin <name> [--remove-pkg]
zhin uninstall adapter <name> [--remove-pkg]
```

`name` 可以是 npm 包名或 instanceKey；`--remove-pkg` 同时从 `package.json` 移除依赖。网关在运行时经网关执行（停启实例、失败回滚）。系统服务用 `zhin service uninstall` 卸载。

### enable / disable：启用或停用插件实例 {#enable-disable}

```bash
zhin disable <instanceKey 或包名>
zhin enable <instanceKey 或包名>
```

把已安装并已声明的插件实例加入或移出配置文件的 `disable_plugins`，不改依赖、不删实例配置块（彻底移除用 `zhin uninstall plugin`）。参数是 `plugins.<instanceKey>` 的实例键；包名只在它只声明了一个实例时可用，多实例时须写实例键。

| 情况 | 结果 |
| --- | --- |
| 网关在运行（`zhin start`） | 经网关事务执行：备份配置 → 停止实例 → 写入 `disable_plugins` → 启动实例并等待就绪；启动失败时恢复配置文件并启动原实例（不运行包管理器）。需要 `plugin.manage` 权限，本地 socket 视为所有者 |
| 网关未运行 | 直接写入配置文件，下次 `zhin start` 时生效 |
| 已是目标状态 | 成功退出，不改配置，也不重启实例 |
| 未声明、保留键（`http`、`plugins` 等）、项目根插件 | 报错，退出码 1 |
| `enable` 时包未安装、依赖无法解析或实例配置不通过插件 Schema | 报错，退出码 1，配置不变；`disable` 不要求包仍已安装，可用来先停掉一个损坏的插件 |

### update：更新依赖

```bash
zhin update [包名 | 包名@精确版本 ...]
```

不带包名时更新全部依赖（`pnpm update`）。网关在运行时经网关执行同一事务（停实例 → 更新 → 启实例，失败回滚），否则直接执行。

### search / info：发现插件

```bash
zhin search [keyword] [-c utility|service|game|adapter|admin|ai] [-l 20] [--official]
zhin info <package>
```

搜索插件市场，或查看单个插件的详情。

### use-cases：按用途找到配置入口 {#use-cases}

```bash
zhin use-cases
zhin use-cases reminder
zhin use-cases personal-reminder
zhin use-cases group-welcome
zhin use-cases keyword-reply
```

查看提醒、群欢迎和关键词回复所需的插件、安装预览、操作步骤与当前限制。本命令只输出指南，不安装插件、不写配置、不启动 Bot，也不发送消息；具体操作仍使用现有安装、配置和聊天入口。

Console「运维 → 定时任务」的[管理员任务](../paths/console.md#管理员任务中心)页签使用同一份用途目录。首版可在网页创建和管理管理员提醒；群欢迎和关键词回复目前提供现有入口指南，不能在网页伪造群成员执行命令。

### preview：预览组件与页面

```bash
zhin preview [dir] [-p 4176] [-H 127.0.0.1] [--open]
zhin preview --export preview.html     # 导出单文件静态 HTML 快照后退出
zhin preview --json                    # 输出扫描与渲染结果后退出
```

启动本地预览工作台：自动扫描项目或插件目录（默认当前目录）的 `components/*` 与 `pages/*`，支持热重载，并可在线修改 Props、调整样式。默认监听 `127.0.0.1:4176`，`--open` 启动后自动打开浏览器。

### build：构建插件

```bash
zhin build [plugin] [--clean] [--no-production]
```

`plugin` 是相对于 `plugins/` 的路径（如 `adapters/icqq`）；省略时在插件目录内构建当前包，或在 workspace 根目录批量构建 `plugins/*`。`src/` 用 tsc 编译，`client/` 用 esbuild 打包；`--clean` 先清理 `lib/` 与 `dist/`；`--production`（默认开启）压缩 client 产物。

### plugin check：发布前检查插件

```bash
zhin plugin check [插件目录] [--no-pack] [--json] [--strict]
```

在插件目录（默认当前目录）检查能否正确发布，发布前跑一次即可：`npx @zhin.js/cli plugin check`。

- **清单与目录**：`package.json` 的 `name`、`zhin` 清单、`zhin.entry` 指向 JavaScript 且有对应源文件；`files` 白名单覆盖入口、约定目录（`commands/`、`tools/` 等编译出的 `.js`，以及 `skills/`、`agents/`）与 `schema.json`；`prepack` / `postpack` 会生成并清理运行时入口。缺少 README 或测试只给警告。
- **zhin 清单与依赖**：用 Runtime 加载时同一个解析器校验 `zhin` 清单（`protocol`、`type`、`entry`、`runtime`、`features`、`plugins`）；`zhin.engine` 必须是当前 Runtime 引擎满足的 semver 范围，`features[].api` 必须是有效范围；`features` / `plugins` 引用的包必须写进 `dependencies` 或 `peerDependencies`。`peerDependencies` 需要声明 `zhin.js`，范围必须是真实的 semver 范围（`latest`、`*`、`file:` / `link:` 报错），本地安装的版本不在范围内时给警告；Zhin 栈写在 `dependencies` 里时给警告。
- **发布包**：实际运行插件的 `npm pack`（会执行 `prepack` 构建），在临时目录解包后检查入口与 `main` / `exports` 是否打包、打包的 JavaScript 里相对 import 能否解析、测试与构建配置有没有混入，以及约定目录里的每个 `.ts` 都有打包的 `.js`；最后借用插件自己的 `node_modules` 在子进程里 `import` 打包后的 `zhin.entry` 做冒烟测试（未安装依赖时跳过并给警告）。规则与仓库的 `pnpm check:pack-imports` 相同。`--no-pack` 跳过这一步。
- 有错误时退出码为 1；`--strict` 把警告也视为失败；`--json` 输出结构化结果，便于在 CI 中使用。

### pub：发布插件

```bash
zhin pub [plugin-name|插件目录] [--tag latest] [--access public] [--registry <url>] [--dry-run] [--skip-build] [--skip-check] [--yes]
```

- 在 `zhin new --standalone` 生成的插件目录里，不带参数就发布当前目录：`npx @zhin.js/cli pub --dry-run` 预览，`npx @zhin.js/cli pub` 发布（`npx @zhin.js/cli` 在任何版本下都可靠；`npx zhin` 从 `zhin@4` 起才等价，见本页开头的提示）。
- 参数也可以是任意插件目录（`package.json` 有 `zhin` 字段），如 `zhin pub ../my-plugin`。
- 在 Bot 项目根，参数是相对 `plugins/` 的路径；不传时只有一个插件就直接选中，多个时交互选择。
- `--dry-run` 只走流程，不实际发布；非交互环境（CI）需要加 `--yes` 才会跳过发布确认。`private: true` 的包会被拒绝，`zhin.entry` 指向 `.ts` 时会提示改用构建出的 `.js`。
- 发布前会自动运行 [`zhin plugin check`](#plugin-check-发布前检查插件)（含 `npm pack`）：有错误时停止发布，只有警告时继续；确需跳过加 `--skip-check`。完整发布流程见 [插件完整交付](../authoring/plugin-delivery.md)。

### packages：插件状态与扩展包

**管理技能 / 扩展包**（ADR 0010）：

```bash
zhin packages install <pkg|npm:skill-pack|git:url> [--local]
zhin packages remove <name> [--local]
zhin packages list [--local]
zhin packages update [source] [--local]
```

`--local`（`-l`）安装到项目的 `.zhin/packages/`，而不是全局。不带 `npm:` / `git:` 前缀时，与 `zhin install <包名>` 和 Console 使用同一套安装流程。

**查看插件是否真正生效**：安装完成不等于已经加载、平台已上线或功能已验证。用下面的命令查看状态并执行验证：

```bash
zhin packages status <instanceKey>
zhin packages status <instanceKey> --live http://127.0.0.1:8068
zhin packages verification-plan <instanceKey> --live http://127.0.0.1:8068
zhin packages apply <instanceKey> --live http://127.0.0.1:8068 --project-revision <revision>
zhin packages verify <instanceKey> <check-id> --live http://127.0.0.1:8068 \
  --generation <generation> --project-revision <revision> --check-revision <checkRevision>
```

`status` 返回的状态：

| 状态 | 含义 |
| --- | --- |
| `installed` | 包可以解析 |
| `declared` | 实例已声明 |
| `missing-config` | 必填配置或环境变量缺失，或配置值不符合 schema |
| `pending-restart` | 当前运行的版本还没有应用 |
| `enabled` | 已生效，配置与包版本一致 |
| `degraded` | 声明与实际安装不一致，或依赖检查失败 |

另外，`readiness` 单独记录就绪证据（包含适配器但没有平台健康证据时为 `unknown`）；`verification` 只表示是否提供了业务检查，**启动成功不等于业务通过**。

::: details 实时请求、验证流程与并发规则
- **Token**：实时请求从 `ZHIN_CONSOLE_TOKEN` 读取 Console token，也可以用 `--token-env <变量名>` 指定。`verification-plan`、`apply`、`verify` 需要完整权限。不要把 token 写在 URL 或命令参数里。
- **HTTPS**：携带 token 的远程请求必须使用 HTTPS；HTTP 只允许 `localhost`、`127.0.0.0/8` 和 `::1`。
- **离线模式**：离线 `status` 只提供文件与包解析证据；离线验证计划没有当前版本或可执行的检查，也不会启动 Runtime。
- **验证步骤**：先看 `verification-plan` 的作用范围与副作用，再把返回的 `generation`、`projectRevision`、`checkRevision` 传给 `verify`。配置、版本或检查定义变化后，旧计划会被拒绝。未提供检查的插件返回 `not-configured`；本地检查通过不代表平台投递已验证。`apply` 只是申请应用，之后用实时 `status` 确认是否真正生效。
- **Schema**：已加载的配置 schema 只适用于同一包版本，更新后改读磁盘上的 `schema.json`。如果新版本只在 TypeScript 中声明配置、没有可读的 schema，`validation.schemaAvailable` 为 `false`，此时只检查环境变量引用，完整校验要由真正的 Runtime 预检完成。
- **生产依赖**：自动启用的插件必须安装为生产依赖；`--save-dev` 必须同时指定 `--no-enable`，这个组合会在安装前检查。
- **并发**：项目变更使用文件锁和 revision 校验。并发操作或配置漂移会明确失败；安装步骤已经完成时返回部分完成的证据，不会自动覆盖用户改动。如果锁所属的进程已经退出，错误信息会给出锁路径，确认没有其他安装进程后删除该锁再重试。
:::

## 操作运行中的 Bot

以下命令通过 HTTP 连接正在运行的 Bot，需要先用 `zhin start` 启动并启用 HTTP 服务。请求携带 `ZHIN_CONSOLE_TOKEN` 里的 Console API 令牌（在 Console 个人设置里签发，权限不超过签发人）；Console 初始化之后 `http.token` 一律被拒绝，没有设置 API 令牌时这些命令返回 401。

### send：向运行中的 bot 发消息

```bash
zhin send <scene_id> [content...] [-s private|group|channel] [-a <adapter>] [-e <endpoint>]
```

`scene_id` 私聊时是用户 ID，群聊时是群号；不传 `content` 时从标准输入读一行。只有一个适配器时可省略 `-a`，否则必须指定；`-e` 指定账号 ID，省略时用该适配器下第一个在线账号。

### watch：监视运行实例

```bash
zhin watch [-i 3] [--once] [--json] [--no-clear]
```

在终端里定时刷新状态面板（统计、账号、助手任务）。`--once` 拉取一次后退出，`--json` 适合脚本使用。

### schedule：持久化调度任务

让 AI 在指定时间执行一段提示词。命令通过 Host API 操作运行中的实例，立即生效；需要 Bot 已用 `zhin start` 启动并启用 `assistant.enabled`。

```bash
zhin schedule list
zhin schedule add "0 0 9 * * *" --prompt "早上好，汇报今日日程" [--kind solar|lunar|workday|freeDay]
zhin schedule add --every 30m --prompt "检查一下 RSS"
zhin schedule add --at 2026-08-01T09:00:00Z --prompt "一次性提醒"
zhin schedule remove <id>
zhin schedule pause <id>
zhin schedule resume <id>
```

| `add` 选项 | 说明 |
| --- | --- |
| `--prompt` | 必填，到时间后发给 AI 的提示词 |
| `-l, --label` | 任务名称 |
| `--kind` | `solar`（默认，公历）/ `lunar`（农历）/ `workday`（工作日）/ `freeDay`（休息日） |
| `--notify-channel` | `im` / `silent`（默认）/ `log` |
| cron 表达式、`--at`、`--every` | 三选一：六段 cron（秒 分 时 日 月 周）、单次 ISO8601 时间、或间隔（如 `30m`、`1h`、`1d`） |

### agent：Agent 诊断

需要安装 AI 栈（`@zhin.js/agent` + `zod` + `ai`）。

```bash
zhin agent info [--json]
```

| 命令 | 作用 |
| --- | --- |
| `info` | 列出发现的 Agent 能力与命名 Agent（Tools、Skills、Hooks 等） |

### trace：查看 Agent 回合

需要安装 AI 栈。机器人每处理完一次 AI 对话，就把这一回合的 trace 追加到 `data/agent-traces/<UTC 日期>.jsonl`（一天一个文件）。排查问题时不用再翻 `bot.db` 和 journal：

```bash
zhin trace                       # 等同于 zhin trace last，打印最近一次回合
zhin trace <turnId>              # 指定回合，可以只写 id 前缀
zhin trace --list                # 列出最近的回合（默认 50 条）
zhin trace --sessions            # 列出有 trace 的会话
zhin trace --session qq:bot:private:12345 --since 2h   # 某个会话最近 2 小时的回合
zhin trace --list --since 2026-10-14 --until 2026-10-15 -n 200
zhin trace last --json
zhin trace --engagements --list   # 列出最近的多 Agent 协作（Engagement）
zhin trace --engagements          # 最近一次协作的协作图
zhin trace <engagementId>         # 指定协作，可以只写 id 前缀
```

| 选项 | 作用 |
| --- | --- |
| `-l, --list` | 每个回合一行：时间、结束状态、回合 id、会话、工具次数、token 数 |
| `--sessions` | 每个会话一行：回合数、最近一次时间与状态、累计 token |
| `--engagements` | 改为读取多 Agent 协作记录（数据库 `engagement_events` 表，需要 SQLite、MySQL 或 PostgreSQL）：配合 `--list` 列出最近的协作，否则显示最近一次或指定协作的参与者、消息跳数、黑板与预算。见[多 Agent 协作与场所](../ai/multi-agent-harness.md) |
| `-s, --session <key>` | 只看这个会话（sessionKey），会自动按列表输出 |
| `--since <time>` / `--until <time>` | 时间范围（`--until` 不含）：`30m`、`2h`、`7d`（多久以前）、ISO 日期/时间或毫秒时间戳 |
| `-n, --limit <n>` | 最多显示最近 n 条，默认 50 |
| `--json` | 输出原始 JSON（snake_case 字段） |
| `--no-timeline` | 不打印逐步时间线 |
| `--cwd <dir>` | 项目根目录，默认当前目录 |
| `--dir <dir>` | 直接读某个 trace 目录（评测失败时报告里会给出这个参数） |

一条 trace 包含：发起人与角色、会话、每次模型调用的 token、每次工具调用（参数摘要、耗时、结果大小、错误或拒绝策略）、预算延长与自动续跑、嵌套的子 agent 回合、上下文分段开销，以及结束原因。输出开头会单独标出**首个失败步骤**。

**保留与脱敏。** 默认保留 7 天，总大小上限 64 MB：启动时和之后每小时清理一次，先删过期的日期文件，再从最旧的一天删起直到低于上限（当天的文件不会因大小被删）。用环境变量 `ZHIN_TRACE_RETENTION_DAYS`、`ZHIN_TRACE_MAX_MB` 调整。trace 只存摘要：工具结果只记录长度，不保存内容；参数和错误信息里的 token、密码、`Authorization` 等字段会被替换成 `[redacted]`，写盘前还会再扫一遍内联凭据（`sk-…`、`Bearer …` 等）和环境变量里的密钥值。旧版的 `data/agent-traces/recent.json` 仍会被读取。

**Console 页面。** Console 的「Agent Trace」页（`/console/agent-trace`）读取同一份数据：会话列表 → 回合列表 → 回合详情（模型/工具调用瀑布图、时间线和原始记录），可以按时间筛选，`?turn=<turnId>` 直接打开某个回合。项目里放一个页面即可启用：

```tsx
// pages/agent-trace/index.tsx
import { TraceArchivePage } from '@zhin.js/client';
import { definePage } from '@zhin.js/console-contract';

export const meta = definePage({ title: 'Agent Trace', icon: 'Activity', order: 31 });
export default TraceArchivePage;
```

页面背后是只读接口 `GET /api/agent/trace-archive/sessions`、`/turns?sessionKey=&since=&until=&limit=`、`/turn?turnId=`，需要 `agent.view` 权限，没有该权限的账号或 API 令牌会得到 403。

**评测联动。** `pnpm eval:agent` 里失败的用例会把它的回合 trace 写进 `ZHIN_EVAL_TRACE_DIR`（默认系统临时目录下的 `zhin-eval-traces`），报告里每个回合一行 `↪ zhin trace <turnId> --dir …`，复制运行即可查看。

### usage report：真实用量账本

只读。读取 `data/agent-traces/*.jsonl`，按天（本地日期）汇总真实模型用量，用来判断上下文优化是否真的省了 token（ADR 0043 §6）。逐行流式读取，不写任何文件；损坏的行会计数并在末尾报告。

```bash
zhin usage report                                  # 今天
zhin usage report --days 7                         # 最近 7 天（含今天）
zhin usage report --since 2026-10-28 --until 2026-10-29
zhin usage report --session 'icqq:*:group:*' --json
```

| 选项 | 作用 |
| --- | --- |
| `--days <n>` | 最近 n 天，默认 1 |
| `--since <time>` / `--until <time>` | 时间范围（`--until` 不含）：`2h`、`7d`、`YYYY-MM-DD`（本地零点）、ISO 时间或毫秒时间戳；给了 `--since` 就忽略 `--days` |
| `-s, --session <pattern>` | 会话键子串，或带 `*` 的通配 |
| `--json` | 输出 JSON |
| `--cwd <dir>` / `--dir <dir>` | 项目根目录 / 直接指定 trace 目录 |
| `--tz <zone>` | 按此 IANA 时区划分日期；默认实例时区（`TZ` 环境变量，否则系统时区） |

每天还会列出按「服务名 · 模型」合并的模型用量：同一服务经 `services:` 与 `accounts:` 两种 ID 记录的调用合为一行，服务名读自项目数据库里的模型配置；读不到时只显示模型名。会话列优先显示 trace 里记录的会话名（如 `qq · 群 测试群`），括号里是会话键的短形式。输入 tokens 是每次模型调用上报的输入之和（含多轮迭代与子 Agent），和下面基于首次请求估算的段占比不是同一口径。

每天输出：回合数、模型调用数、每回合调用次数与单次调用输入 token 的 p50 / p90 / max、缓存命中占比（`cache_read_tokens` / `prompt_tokens`）、历史 / 固定 / 用户三段占比、撞迭代上限的回合数，以及输入 token 最多的前 5 个会话。段占比来自各回合首次请求的估算（`context_budget`），固定段 = system + tool_schemas + output_schema + tool_index + skill_catalog + agent_catalog + memory + bootstrap。「撞迭代上限」指出现 `last_iteration_nudge` 或以 `budget_exceeded` 结束的回合。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 正常退出 |
| `3` | `zhin status`：网关未运行 |
| `130` | 被信号中断 |
| 其他非零 | 网关启动失败（端口被占用、同一项目已有网关、Node 版本不满足、配置读取失败），或管理命令失败（套接字属于其他用户、网关无响应、事务失败已回滚）。实例崩溃不会结束网关：实例由网关重启，需要重启时经控制通道请求网关，不通过退出码 |

`zhin config` 与 `zhin doctor --live` 有各自的退出码（见上文）。进程模型、各启动方式的退出码与热重载行为见 [zhin start](./runtime.md#退出码)。

## 迁移应用实例声明

旧项目需先停止 Bot，再迁移到 `configVersion: 2`。命令默认只预览，不安装依赖或启动插件：

```bash
zhin migrate instances
zhin migrate instances --apply
zhin migrate instances --recover continue
zhin migrate instances --recover rollback
```

预览按键名列出改动（新增 `configVersion`、`plugins` 映射、业务块搬移、`disable_plugins`、`package.json#zhin.plugins` 清空），不打印任何配置值，可直接贴到 issue；`--json` 输出机器可读摘要。`--apply` 写入前会把原文件复制到 `.zhin/backups/config-v2-<时间戳>/`（附 `manifest.json`）并打印路径；恢复优先用 `zhin migrate instances --recover rollback`，也可按 manifest 手动复制回原位置。嵌套、optional 和别名碰撞需人工处理。详见[迁移指南](../migrations/plugin-instance-declarations.md)。
