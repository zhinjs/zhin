---
title: 访问控制：用户、角色、API 令牌与审计
description: Console「访问控制」区的四个页面：谁能登录、能做什么、自动化凭据怎么发、出了事怎么查；对应的权限名与 CLI 救援命令
---

# 访问控制：用户、角色、API 令牌与审计

Console 的账号存在项目数据库里（[ADR 0049](../adr/0049-console-rbac.md)），由管理网关负责登录与鉴权（[ADR 0054](../adr/0054-management-gateway.md)）。实例停止或崩溃时这些页面照常可用。

「访问控制」区包含四个页面：**用户**、**角色**、**API 令牌**、**审计日志**。查看需要 `iam.view`，修改需要 `iam.manage`——内置角色里只有 `owner` 持有 `iam.manage`，`admin` 只有 `iam.view`。没有 `iam.view` 的账号看不到这个区。

## 凭据 {#credentials}

| 凭据 | 怎么得到 | 用在哪里 |
| --- | --- | --- |
| 初始化令牌 | 配置里的 `http.token`（脚手架写入 `.env` 的 `HTTP_TOKEN`） | 只在还没有所有者时用于初始化向导（[引导](./onboarding.md)）；创建所有者后在所有接口上返回 401 |
| 会话令牌 | 用户名 + 密码登录（`POST {base}/auth/login`） | 浏览器里的 Console。默认 12 小时滑动过期、最长 30 天 |
| API 令牌 | 用户签发（见下文） | CI、监控、`zhin doctor --live`、MCP / A2A 客户端；命令行从 `ZHIN_CONSOLE_TOKEN` 读取 |

所有凭据都以 `Authorization: Bearer …` 发送，不使用 Cookie。登录失败统一返回 401，同一 IP 与用户名 15 分钟内失败 5 次后指数退避（`429`）。

## 用户 {#users}

列出全部用户：用户名、显示名、是否禁用与角色绑定。

| 操作 | RPC | 权限 |
| --- | --- | --- |
| 查看列表 | `iam.users.list` | `iam.view` |
| 新建用户（用户名小写唯一，密码至少 10 位） | `iam.users.create` | `iam.manage` |
| 改显示名 | `iam.users.update` | `iam.manage` |
| 禁用 / 启用 | `iam.users.disable` | `iam.manage` |
| 删除 | `iam.users.delete` | `iam.manage` |
| 重置密码 | `iam.users.reset-password` | `iam.manage` |
| 修改角色绑定 | `iam.bindings.set` | `iam.manage` |

- 改密码、禁用或删除用户后，该用户的全部会话立即失效；禁用或删除还会让他签发的 API 令牌失效。
- 上述操作和改动角色绑定都会让他在实例上打开的事件流与 WebSocket 随即断开（之后按新权限重新连接）；绑定变化对后续请求立即生效，因为每个请求都按当前绑定授权。
- 系统里始终至少保留一个未禁用、拥有全局 `owner` 绑定的用户：删除、禁用或降级最后一个所有者会被拒绝。
- 每个用户可以在「个人设置」里改自己的密码（`POST {base}/auth/password`）。

### 角色绑定与作用域 {#scopes}

一个绑定 = 角色 + 作用域：

| 作用域 | 写法 | 覆盖范围 |
| --- | --- | --- |
| 全局 | — | 一切 |
| 适配器 | 适配器实例别名，如 `qq` | 该适配器及其下全部账号 |
| 账号 | `<别名>/<endpointId>`，如 `qq/bot-1` | 只有该账号 |

只有 `endpoint.view`、`endpoint.operate`、`endpoint.manage`、`feature.configure`、`feature.toggle` 会按作用域收窄；其他权限只认全局绑定。例如「只管 Telegram 的运营」：给他绑定 `operator`，作用域选适配器 `tg-main`。

## 角色 {#roles}

内置角色不能删改，可以复制后再改：

| 角色 | 权限 |
| --- | --- |
| `owner` | 全部（含 `ops.terminal`、`iam.manage`） |
| `admin` | 除 `ops.terminal`、`iam.manage` 外的全部 |
| `operator` | `status.view`、`endpoint.view`、`endpoint.operate`、`feature.view`、`feature.configure`、`feature.toggle`、`agent.view`、`ops.schedule.read`、`plugin.perms.read`、`plugin.perms.operate` |
| `viewer` | 所有 `*.view` 与 `*.read`，不含 `ops.config.read`、`ops.env.read`（可能含机密） |

| 操作 | RPC | 权限 |
| --- | --- | --- |
| 查看角色与插件权限目录 | `iam.roles.list` | `iam.view` |
| 新建 / 修改 / 删除自定义角色 | `iam.roles.create` / `iam.roles.update` / `iam.roles.delete` | `iam.manage` |

### 权限目录 {#permissions}

| 权限 | 覆盖 |
| --- | --- |
| `status.view` | 仪表盘、系统状态、日志、能力浏览、事件流、实例状态与日志 |
| `endpoint.view` / `endpoint.operate` / `endpoint.manage` | 账号与会话读取 / 发消息、处理请求、登录辅助 / 增删改启停账号连接 |
| `feature.view` / `feature.configure` / `feature.toggle` | 读取功能配置 / 写配置与覆盖 / 启用禁用（见[功能与三级配置](./features.md)） |
| `plugin.manage` | 安装、更新、卸载插件与依赖；引导第 3–5 步 |
| `agent.view` / `agent.configure` | AI 与 Agent 读取 / 写入 |
| `ops.config.read` / `ops.config.write` | 原始配置文件 |
| `ops.env.read` / `ops.env.write` | 环境变量文件 |
| `ops.database.read` / `ops.database.write` | 数据库浏览 / 增删改 |
| `ops.schedule.read` / `ops.schedule.write` | 定时任务 |
| `ops.files.read` / `ops.files.write` | 项目文件（读写 `.env` 与配置文件仍需要对应的 `ops.env.*` / `ops.config.*`） |
| `ops.restart` | 实例起停与重启 |
| `ops.terminal` | 终端（见[运维](./operations.md#terminal)） |
| `iam.view` / `iam.manage` | 本区 |
| `mcp.access` / `a2a.access` | MCP Server、A2A Server 的 Bearer 访问 |
| `plugin.perms.read` / `plugin.perms.operate` / `plugin.perms.manage` | 按级别授予全部插件权限 |

每个 Console RPC、每条 `{base}` HTTP 路由、每个由 Host 鉴权的 WebSocket 都登记在 `@zhin.js/console-protocol` 的权限表（`CONSOLE_RPC_PERMISSIONS`、`CONSOLE_HTTP_PERMISSIONS`、`CONSOLE_WS_PERMISSIONS`）里；没登记的对所有已登录主体一律拒绝。

### 插件权限 {#plugin-permissions}

插件自己的权限名形如 `<插件>:<动作>`（`onebot11:read`、`ambient:read`、`ops:approve`），属于 `read` / `operate` / `manage` 三级之一，由插件在 `definePluginConsoleRpc({ permissions })` 里声明；没声明时按后缀推断（`:read` / `:view` → `read`；`:approve` / `:manage` / `:admin` / `:write` / `:config` → `manage`；其余 → `operate`）。

- `viewer` 得到 `read` 级，`operator` 得到 `read` + `operate`，`admin` 与 `owner` 得到全部。
- 自定义角色可以勾选级别权限，也可以直接列出插件权限名。当前没有插件使用的名字也能保存（插件可能还没装），保存结果带 `warnings`，在有插件用到它之前它不放行任何东西。
- 角色编辑器里，每个角色显示实际生效的插件权限及来源（`level` / `explicit`），以及已加载插件的权限目录（来自实例；实例离线时网关沿用上一份）。
- 插件 Console RPC 按方法检查：方法自己声明的权限和所属页面的要求都要满足；都没声明时读方法需要 `feature.view`、动作需要 `feature.configure`。

## API 令牌 {#api-tokens}

| 操作 | 接口 | 权限 |
| --- | --- | --- |
| 我的令牌（个人设置） | `GET` / `POST {base}/auth/tokens`、`POST {base}/auth/tokens/revoke` | 已登录即可 |
| 全部令牌 | `iam.tokens.list` | `iam.view` |
| 为用户签发 / 吊销 | `iam.tokens.create` / `iam.tokens.revoke` | `iam.manage` |

签发时填名称、过期时间，可以只勾选需要的权限（例如就绪探测只要 `status.view`，MCP 客户端只要 `mcp.access`）。

- 明文**只在签发时显示一次**，库里只存 SHA-256。
- 令牌的权限不超过签发用户：列出的插件权限只有用户自己（按名或按级别）持有时才生效；用户被禁用、删除时令牌一起失效；也可以单独吊销。
- 命令行工具读 `ZHIN_CONSOLE_TOKEN`：`ZHIN_CONSOLE_TOKEN=<令牌> zhin doctor --live https://bot.example.com/api --json`。

## 审计日志 {#audit}

`iam.audit.list`（`iam.view`）分页列出 `console_audit_log`，可按主体、动作、时间过滤。

| 记录的事件 | 说明 |
| --- | --- |
| 登录成功 / 失败、登出、改密码 | 主体、IP |
| 全部 `iam.*` 写操作 | 用户、角色、绑定、令牌的变化 |
| 映射为写权限的 RPC | 实例侧的写操作由实例上报，网关写入 |
| 全部被拒绝的请求 | `outcome: denied` |
| 终端会话开始 / 结束 | 目标、时长、退出码与原因；不记录输入输出 |

- 主体写作 `bootstrap`、`user:<id>`、`api-token:<id>`；`detail` 只记录 RPC 类型、目标与参数键名，不记录参数值与机密。
- 保留 180 天，按天清理。
- 网关不读取 `X-Forwarded-For`：放在反向代理后面时，记录的 IP 是代理地址。

## 离线救援 {#rescue}

忘记密码或所有者被锁：在服务器上直接操作项目数据库，不需要运行中的网关，也没有在线的超级凭据。

```bash
zhin console user list
printf '%s\n' "$NEW_PASSWORD" | zhin console user passwd alice --password-stdin
zhin console user enable alice
printf '%s\n' "$PASSWORD" | zhin console user create rescue --role owner --password-stdin
```

`zhin console user create` 不带 `--role` 时为 `viewer`。

## 相关

- [升级到 Console 访问控制](../migrations/console-access-control.md)
- [部署演示站点](../operations/demo-deployment.md)：只读账号与加固
- [Console 总览](./index.md)
