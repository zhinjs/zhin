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
| `operator` 运营 | `status.view`、`endpoint.view`、`endpoint.operate`、`feature.view`、`feature.configure`、`feature.toggle`、`agent.view`、`ops.schedule.read` |
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

### 7. CLI

`zhin console user create <username> [--role owner] [--password-stdin]`、`zhin console user passwd <username>`、`zhin console user disable|enable <username>`、`zhin console user list`。CLI 直接打开项目数据库，不经过运行中的 Host，用于首次初始化与救援。

## 落盘位置

- 权限常量与 RPC→权限映射：`packages/console/protocol/src/permissions.ts`
- 主体解析、权限检查：`packages/host/http/src/`（`TokenRegistry` 扩展为可接入外部会话解析器；新增 `access-control.ts`）
- 数据表、密码与会话、`/auth/*`、`iam.*`、审计：`basic/cli/src/plugin-runtime/console/iam/`
- CLI 命令：`basic/cli/src/commands/console-user.ts`
- Console UI：登录页（用户名密码；未初始化时显示初始化向导）、访问控制区（用户、角色、API 令牌、审计）、个人设置（改密码、我的令牌）

## 后果

- 现有部署升级后需要初始化一次：用 `http.token` 登录 Console 创建所有者（或 `zhin console user create --role owner`），之后改用账号登录；自动化改用 API 令牌。使用 `http.tokens` 的配置需要迁移。
- 所有 RPC 由「全权 / 演示白名单」变为逐项权限检查；新增 RPC 必须登记权限，`check:console-protocol-boundaries` 增加对应门禁。
