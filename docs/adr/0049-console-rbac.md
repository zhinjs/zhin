---
sidebar: false
---

# ADR 0049：Console 访问控制——数据库里的用户、角色与权限

状态：Accepted（2026-11-11）

## 背景

Console 目前只认 Bearer 令牌：`http.token` 是全权，`http.tokens[]` 里可以挂 `scope: demo|user` 加一组 `permissions` / `roles`，但这些权限只用来决定**页面**可见性（`requiredPermissions`）；RPC 层只有两档——全权，或演示白名单（`DEMO_RPC_ALLOWLIST`）。没有用户、没有密码、没有会话失效、没有审计。随着终端（ADR 0051）和三级功能配置（ADR 0050）进入 Console，单令牌不够了。

Zhin 总是有数据库（未配置时为 `.zhin/data.sqlite`），因此访问控制模型直接放在数据库里。

## 决策

### 1. 主体与凭据

| 主体 | 凭据 | 说明 |
|---|---|---|
| **初始化令牌** | `http.token` | 只用于首次初始化：数据库里还没有任何启用的全局所有者时，凭它创建第一个所有者（`POST /auth/setup`）。初始化完成后该令牌在任何接口上都被拒绝（401）。 |
| **用户** | 用户名 + 密码 → 会话令牌 | 新增。会话令牌以 Bearer 发送，与现有 SSE / REST 调用方式一致。 |
| **API 令牌** | 用户签发的长期令牌 | 新增。权限 ≤ 签发用户，可单独吊销。 |

`http.tokens[]` 与演示模式移除。配置里仍有 `http.tokens` 时启动报错，并提示改用用户与 API 令牌。演示站点改为一台真实的 Host，开一个只读（`viewer`）账号供人登录。

救援（忘记密码、所有者被锁）只走离线 CLI（§7），没有在线的超级凭据。

不使用 Cookie：Console 站点（`console.zhin.dev`）与 Host 不同源，Cookie 会把 CSRF 带进来，Bearer 不会。

### 2. 数据表（`console_` 前缀，由 CLI composition root 定义）

| 表 | 字段（要点） |
|---|---|
| `console_users` | `id`、`username`（唯一，小写）、`display_name`、`password_hash`、`disabled`、`password_changed_at`、`created_at`、`updated_at` |
| `console_roles` | `id`、`name`（唯一）、`description`、`builtin`、`permissions`（JSON 数组） |
| `console_role_bindings` | `id`、`user_id`、`role_id`、`scope_kind`（`global` \| `adapter` \| `endpoint`）、`scope_key`（`global` 时为空；`adapter` 为适配器实例别名；`endpoint` 为 `别名/endpointId`） |
| `console_sessions` | `id`（会话令牌的 SHA-256）、`user_id`、`created_at`、`expires_at`、`last_seen_at`、`ip`、`user_agent` |
| `console_api_tokens` | `id`、`user_id`、`name`、`token_hash`（SHA-256）、`permissions`（可选，收窄用）、`expires_at`、`last_used_at`、`created_at` |
| `console_audit_log` | `id`、`at`、`actor`（`bootstrap` / `user:<id>` / `api-token:<id>`）、`action`、`target`、`outcome`（`ok` / `denied` / `error`）、`detail`（JSON，不含机密）、`ip` |

- 密码：`node:crypto` scrypt（N=2^15, r=8, p=1, 32 字节盐），比较用 `timingSafeEqual`。最短 10 位。
- 令牌：32 字节随机数，base64url；库里只存 SHA-256。会话默认 12 小时滑动过期、最长 30 天。
- 改密码、禁用用户、删除用户：该用户全部会话立即失效；API 令牌在禁用/删除时失效。

### 3. 权限目录

权限是字符串常量，集中定义在 `@zhin.js/console-protocol`（`CONSOLE_PERMISSIONS`），Host 与 Console 共用。

| 权限 | 覆盖 |
|---|---|
| `status.view` | 仪表盘、系统状态、日志读取、能力浏览、Agent 观测 |
| `endpoint.view` | 账号列表、详情、会话/收件箱读取 |
| `endpoint.operate` | 发消息、群管理动作、处理请求/通知、登录辅助 |
| `endpoint.manage` | 新增 / 修改 / 删除 / 启停账号连接 |
| `feature.view` | 读取功能配置（不含机密字段值） |
| `feature.configure` | 写功能配置（任意层级，受作用域约束） |
| `feature.toggle` | 启用 / 禁用功能（任意层级，受作用域约束） |
| `plugin.manage` | 安装 / 更新 / 卸载 / 校验插件 |
| `agent.view` / `agent.configure` | AI 与 Agent 相关读取 / 写入（模型、技能、Ambient、场所） |
| `ops.config.read` / `ops.config.write` | 原始配置文件读取 / 写入、应用配置 |
| `ops.env.read` / `ops.env.write` | 环境变量文件 |
| `ops.database.read` / `ops.database.write` | 数据库浏览 / 增删改 |
| `ops.schedule.read` / `ops.schedule.write` | 定时任务 |
| `ops.files.read` / `ops.files.write` | 项目文件 |
| `ops.restart` | 重启进程 |
| `ops.terminal` | 终端（ADR 0051） |
| `iam.view` / `iam.manage` | 用户、角色、API 令牌、审计日志 |
| `mcp.access` / `a2a.access` | MCP Server、A2A Server 的 Bearer 访问 |
| `plugin.perms.read` / `plugin.perms.operate` / `plugin.perms.manage` | 插件自定义权限，按级别授予（见[修订 2026-11-11](#修订-2026-11-11插件权限按级别授予)） |

规则：

- **每个 Console RPC 类型与每条 `/api` HTTP 路由都必须映射到一个权限**（`CONSOLE_RPC_PERMISSIONS`）。未映射者对非根主体一律拒绝——新增 RPC 忘记登记就是 403，而不是默默放行。插件贡献的 `plugin.<id>.*` RPC 默认归 `feature.configure`（写）/`feature.view`（读，按插件声明的只读方法），适配器的账号 RPC 归 `endpoint.manage`。
- 公开路由（`/pub/*`、登录、健康检查）不需要权限。
- 作用域：`feature.configure`、`feature.toggle`、`endpoint.*` 检查目标的层级。全局绑定覆盖一切；`adapter` 绑定覆盖该适配器及其下全部账号；`endpoint` 绑定只覆盖该账号。其余权限只认全局绑定。
- MCP、A2A 等其他 Bearer 接口同样接受用户 API 令牌，分别需要 `mcp.access`、`a2a.access`。

### 4. 内置角色（`builtin: true`，可复制不可删改）

| 角色 | 权限 |
|---|---|
| `owner` 所有者 | 全部 |
| `admin` 管理员 | 除 `ops.terminal`、`iam.manage` 外全部 |
| `operator` 运营 | `status.view`、`endpoint.view`、`endpoint.operate`、`feature.view`、`feature.configure`、`feature.toggle`、`agent.view`、`ops.schedule.read`、`plugin.perms.read`、`plugin.perms.operate` |
| `viewer` 只读 | 所有 `*.view` 与 `*.read`（不含 `ops.config.read`、`ops.env.read`，它们可能含机密） |

### 5. 接口

REST（`{http.base}/auth/*`，不带权限要求的只有 login）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/login` | `{ username, password }` → `{ token, expiresAt, user }`；失败统一 401，按 IP 与用户名限速（5 次 / 15 分钟，指数退避） |
| POST | `/auth/logout` | 吊销当前会话 |
| POST | `/auth/setup` | 需初始化令牌：`{ username, password, displayName? }` 创建第一个所有者并返回会话；已有所有者时 409 |
| GET | `/auth/me` | 当前主体：`{ kind: 'bootstrap'|'user'|'api-token', user?, permissions, bindings, setupRequired }`；`setupRequired` 表示库里还没有任何所有者 |
| POST | `/auth/password` | 改自己的密码：`{ currentPassword, newPassword }` |

RPC（`iam.*`，需 `iam.view` / `iam.manage`）：`iam.users.list|create|update|disable|delete|reset-password`、`iam.roles.list|create|update|delete`、`iam.bindings.set`、`iam.tokens.list|create|revoke`（`create` 只在此刻返回明文）、`iam.audit.list`（分页、按主体/动作/时间过滤）。

不变式：初始化之后，系统里始终至少有一个未禁用的、拥有全局 `owner` 绑定的用户；删除 / 禁用 / 降级最后一个所有者被拒绝。

### 6. 审计

写入 `console_audit_log` 的事件：登录成功与失败、登出、改密码、所有 `iam.*` 写操作、所有被拒绝的请求（`outcome: denied`）、所有映射为写权限的 RPC、终端会话开始/结束。`detail` 只记录 RPC 类型、目标与参数键名，不记录参数值。保留 180 天，按天清理。

### 7. 初始化：CLI 与 Web 同一套动作

初始化有两个入口，执行的是同一个服务（`ConsoleSetupService`，`basic/cli/src/plugin-runtime/console/iam/setup-service.ts`），步骤、校验、写入结果完全一致：

| 步骤 | 服务方法 | Web（初始化令牌） | CLI |
|---|---|---|---|
| 查看状态 | `status()` → `{ setupRequired, database: { dialect, source: 'default'|'config', summary } }` | `GET /auth/setup` | `zhin console init --status` |
| 可选驱动 | `drivers()` → `[{ dialect, label, available, missingPackage?, fields }]` | `GET /auth/setup/database` | 交互选择列表 |
| 测试连接 | `testDatabase({ dialect, connection })` → `{ ok, latencyMs?, error? }` | `POST /auth/setup/database/test` | 选择后自动测试，失败可重填 |
| 保存数据库 | `applyDatabase({ dialect, connection })` → `{ restartRequired }` | `POST /auth/setup/database`（随后由 Host 重启进程，返回 `{ restarting: true }`，Console 轮询 `/auth/me`） | 写入后直接用新库继续下一步（CLI 不依赖运行中的 Host；若检测到 Host 正在运行，提示重启它） |
| 创建所有者 | `createOwner({ username, password, displayName? })` → `{ user }` | `POST /auth/setup`（额外签发会话并返回） | 交互输入，或 `--owner <name> --password-stdin` |

- 驱动列表与连接字段来自 `@zhin.js/scaffold-wizard` 的 `DATABASE_DIALECT_DEFINITIONS`，与 `zhin setup` / `create-zhin` 的数据库步骤同源，校验用同一个 `validateDatabaseConfig`。Web 表单和 CLI 提问都由同一份 `fields` 生成。
- 写入规则（两个入口相同）：配置文件顶层 `database` 块经现有原子写入路径保存；机密字段写入项目 `.env`（`ZHIN_DATABASE_PASSWORD` 等），配置里只留 `${…}` 引用。
- 非交互：`zhin console init --database <dialect> --database-<field> <value>… --owner <name> --password-stdin [--yes]`，用于脚本与容器部署；机密字段也可用 `--database-password-env <VAR>` 指向已有环境变量。
- 已初始化后：Web 的 `/auth/setup/*` 返回 409，`zhin console init` 退出并提示改用 `zhin console user …`。
- 救援与日常用户管理（离线，直接打开项目数据库）：`zhin console user create <username> [--role <role>] [--password-stdin]`、`passwd`、`disable|enable`、`list`。

### 8. 初始化细节

- 可选驱动：`sqlite`（默认，`.zhin/data.sqlite`）、`mysql`、`pg`、`mongodb`。`redis` 与 `memory` 不能存账号，不出现在列表里。驱动包（`mysql2`、`pg`、`mongodb`）是 `@zhin.js/database` 的可选依赖，缺失时可在线安装（白名单与安装路径见 ADR 0053 §3），也可手动 `pnpm add <包>`。
- 测试连接：临时连接，执行一次探测查询后断开；错误信息去掉凭据。保存前必定先测试。
- 「保持当前数据库」可以跳过数据库步骤；配置文件里已显式写了 `database` 时默认跳过，但仍可修改。
- 切换数据库不迁移旧库数据（初始化前旧库里没有账号；插件数据留在原库，两个入口都提示这一点）。

## 落盘位置

- 权限常量与 RPC→权限映射：`packages/console/protocol/src/permissions.ts`
- 主体解析、权限检查：`packages/host/http/src/`（`TokenRegistry` 扩展为可接入外部会话解析器；新增 `access-control.ts`）
- 数据表、密码与会话、`/auth/*`、`iam.*`、审计：`basic/cli/src/plugin-runtime/console/iam/`
- 初始化服务：`basic/cli/src/plugin-runtime/console/iam/setup-service.ts`；CLI 命令：`basic/cli/src/commands/console.ts`（`init`、`user`）
- Console UI：登录页（用户名密码；未初始化时显示初始化向导）、访问控制区（用户、角色、API 令牌、审计）、个人设置（改密码、我的令牌）

## 后果

- 现有部署升级后需要初始化一次：用 `http.token` 登录 Console 创建所有者（或 `zhin console user create --role owner`），之后改用账号登录；自动化改用 API 令牌。使用 `http.tokens` 的配置需要迁移。
- 所有 RPC 由「全权 / 演示白名单」变为逐项权限检查；新增 RPC 必须登记权限，`check:console-protocol-boundaries` 增加对应门禁。

## 修订 2026-11-11：插件权限按级别授予

状态：Accepted（所有者决定，方案 A）。

### 背景

插件用自己的权限名限制页面和 Console RPC（`onebot11:read`、`ambient:read`、`ops:approve` 等）。原方案里内置角色只含 §3 的目录权限，自定义角色也只能写目录权限，因此这些插件权限只有全局所有者满足（`TokenRegistry.accessFor` 对全局所有者直接返回不受限），admin / operator / viewer 看不到对应页面。

### 决定

1. **格式与级别**：插件权限写成 `<插件>:<动作>`（`/^[a-z][a-z0-9_-]{0,63}:[a-z][a-z0-9_.-]{0,63}$/`），属于 `read` / `operate` / `manage` 之一。插件在 `definePluginConsoleRpc({ permissions: [{ id, level, description? }] })` 里声明级别；页面元数据不新增字段。未声明的按动作最后一段推断：`read` / `view` → `read`；`approve` / `manage` / `admin` / `write` / `config` → `manage`；其余 → `operate`。同一权限名被多个插件声明为不同级别时取最严格者。
2. **级别权限**：目录新增 `plugin.perms.read`、`plugin.perms.operate`、`plugin.perms.manage`，分别授予该级别的全部插件权限。级别权限本身不进入作用域权限列表；页面可见性与 `/auth/me` 只看全局绑定。调用插件 Console RPC 时，若调用目标是某个适配器或账号（见下文「插件 RPC 按方法授权」），绑定到该适配器 / 账号的角色所含的插件权限（按名或按级别）也算数，绑定到别的适配器的不算。
3. **内置角色**：`viewer` 含 `plugin.perms.read`（随 `*.read` 规则自动纳入）；`operator` 增加 `plugin.perms.read`、`plugin.perms.operate`；`admin` 与 `owner` 含全部三项。`owner` 的全局会话仍然不受限。
4. **自定义角色**可以写入级别权限，也可以按名列出插件权限。当前没有已加载插件使用的权限名**允许保存并返回警告**（`iam.roles.create|update` 的 `warnings`）：插件的安装、停用、热重载与角色编辑相互独立，拒绝会让管理员无法为即将安装的插件预先配置角色；而一个没有插件使用的权限名不放行任何东西，默认拒绝不受影响。格式不合法的仍然拒绝（`invalid_input`）。
5. **API 令牌**的权限列表也可以写插件权限名。收窄时，令牌列出的插件权限只有在签发用户的角色按名或按级别持有它时才保留——令牌不会超过用户。收窄到目录之下的所有者令牌不再视为不受限。
6. **权限目录**：运行时装配根从当前代收集所有页面与 RPC 方法用到的插件权限及其声明，按代缓存，经 `TokenRegistry.usePluginPermissions()` 提供给 Host；`accessFor`、`/auth/me` 据此把级别权限展开为具体的插件权限名，页面过滤与插件 RPC 的权限比较方式不变。
7. **接口**：`iam.roles.list` 返回 `{ roles, pluginPermissions }`——每个角色带 `pluginPermissions: [{ id, level, source: 'level'|'explicit', known, description? }]`，顶层 `pluginPermissions` 是已加载插件的权限目录 `[{ permission, plugin, level, description? }]`（`plugin` 为权限名前缀）。类型 `ConsoleIamPluginPermission`、`ConsolePluginPermissionInfo`、`ConsoleRolePluginPermission` 与推断、展开函数位于 `@zhin.js/console-protocol`。

### 后果

- 升级后已有数据库在启动时重写内置角色，admin / operator / viewer 立即按级别看到插件页面。
- 未声明级别、以 `:write` 结尾的插件权限默认归 `manage`，只有 admin 及以上持有。仓库内已声明为 `operate`：适配器账号写权限（`createAdapterConsoleRpc` 的 `writePermission`，可用 `writePermissionLevel` 改回 `manage`）、`control:write`，以及 rss / reminder / ledger / calendar / qrcode / short-url 的 `:write`。审批（`ops:approve`、`tool_approvals:resolve`）声明为 `manage`；后者按后缀会推断成 `operate`，因此必须显式声明。
- 插件 RPC 按方法强制执行，见下文「插件 RPC 按方法授权」。

### 插件 RPC 按方法授权

此前用户会话与 API 令牌调用插件 RPC 只检查 `feature.view`（读）/ `feature.configure`（写），忽略方法和页面声明的权限，`operator` 因此能调用 `ops:approve` 的动作。现改为：

1. 权限表对插件 RPC（`plugin.<pluginId>.<method>`）只做准入（`delegated`），由插件 RPC 分发器逐个方法判定；分发器没有应答时拒绝。全局所有者仍不受限，初始化令牌的行为不变。
2. 已登录主体必须满足方法自己的 `requiredPermissions` / `requiredRoles` / `anyOfPermissions` 与所绑定页面的要求（插件权限按级别）。都没声明时兜底：读方法需要 `feature.view`；动作自己没有声明要求时需要 `feature.configure`（页面要求照样叠加）。不满足返回 403 `forbidden`。
3. 目标：适配器账号方法（`endpoint-*`）的目标按处理函数选账号的同一规则从 `data` 求出（`consoleAccountTarget`：先 `instanceId`，否则 `id`；`add` / `replace` 只到适配器层）；`id` 与 `instanceId` 同时出现却指向不同账号，或 `data` 之外另带不一致的 `id` / `instanceId`，返回 400 `invalid_input`；拥有适配器的插件（`root/<别名>`，当前代的适配器目录里确有它的适配器）的其他方法以该适配器为目标；其余为全局。绑定到目标适配器 / 账号的角色对目录权限（如 `endpoint.manage`、`feature.configure`）和插件权限都算数；绑定到别的适配器的不算。
4. 账号方法另外接受目标上的 `endpoint.manage`，原有只含 `endpoint.manage` 的适配器作用域角色可继续维护该适配器的账号。处理函数看到的 `runtime.operator`（首次迁移确认）为：适配器目标上持有 `endpoint.manage`，否则全局持有 `feature.configure`。
