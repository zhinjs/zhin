---
sidebar: false
---

# ADR 0054：管理网关——CLI 启动网关，网关管理 Zhin 实例

状态：Accepted（2026-11-11）

## 背景

`zhin runtime start` 的父进程（`NativeTypeScriptSupervisor`，`basic/cli/src/plugin-runtime/start/process-supervisor.ts`）只负责拉起子进程并在退出码 75 时重启；HTTP Host、Console API、配置写入、插件安装都在**子进程**——也就是 Zhin 实例——里（`start-command.ts` 创建 `createHttpHostGroup` 并装配 Console）。后果：

- 实例启动失败、崩溃、重启期间，Console 一起消失：看不了日志、改不了配置、回滚不了依赖；
- 依赖安装发生在运行中的实例里，原生模块被占用，装完只能让实例「自己重启自己」；装坏了实例起不来，Console 也就没了；
- 访问控制（ADR 0049）、初始化与引导（ADR 0053）、终端（ADR 0051）是宿主层面的事，却挂在会被插件拖垮的进程里。

## 决策

### 1. 两个进程

| | 网关（Gateway） | 实例（Instance） |
|---|---|---|
| 启动 | `zhin start`（CLI 的常驻进程，取代现有 supervisor） | 网关拉起的子进程，入口仍是 `zhin runtime start` |
| 职责 | 唯一对外端口；**认证**（会话、API 令牌、初始化令牌）；初始化与引导；实例起停、崩溃重启、日志采集；依赖安装 / 卸载 / 升级；原始配置文件与 `.env` 读写（实例离线时）；终端；审计；本地 Console 静态资源 | IM Runtime、插件、适配器、Agent、定时任务；**绝大部分 Console API**（依赖运行时快照）；插件自己的 HTTP / WS 路由 |
| 加载插件 | 否。可以使用 `@zhin.js/runtime`、`@zhin.js/database`、`@zhin.js/host-http` 等库做配置解析与项目文件操作，但不创建 Runtime、不执行插件代码 | 是 |
| 挂了怎么办 | 由系统服务（`zhin install-service`）或容器重启 | 网关按策略重启；Console 照常可用，显示实例状态与日志 |

### 2. 请求流：网关认证，处理者授权

网关监听 `http.port`（以及 `http.base`，默认 `/api`）。每个请求：

1. **网关自有路由**——直接处理：
   - `{base}/auth/*`、`{base}/auth/setup*`（ADR 0049 §5、§7）
   - `{base}/gateway/*`（本 ADR §4、§5）
   - `{base}/console/terminal*`（ADR 0051）
   - `/pub/health`（网关自身健康；附带实例状态）
   - 本地 Console 静态资源（若配置了 `clientOutDir`）
2. **其余 `{base}/*`**（Console RPC `POST {base}/console/request`、SSE、REST）——网关先认证，再反向代理到实例：
   - 网关解析 Bearer → 主体（用户 / API 令牌），查出其权限与作用域绑定；
   - 去掉原 `Authorization` 头，加上 `x-zhin-gateway-principal`（JSON：`{ id, kind, permissions, bindings }`，base64url）与 `x-zhin-gateway-signature`（以本次启动的随机密钥对 principal 头做 HMAC-SHA256）；
   - 未认证请求直接 401，不转发；实例离线时返回 `503 { code: 'instance-offline', state }`。
3. **其他所有路径**（插件 / 适配器的 Webhook、反向 WS 等）——透明反向代理（HTTP 与 WebSocket upgrade），不做认证，与今天一致：这些路由的鉴权由插件自己负责。

**授权在处理处完成**：实例的 Console RPC 分发点（`dispatchRuntimeConsoleRpc`、扩展分发器、`rpc-route.ts`）按 `CONSOLE_RPC_PERMISSIONS`（ADR 0049 §3）检查网关转发来的主体，因为只有分发点知道 RPC 类型与载荷里的作用域目标。网关自有路由由网关检查。两边使用同一个 `@zhin.js/host-http` 访问控制模块与同一份权限表。

实例只信任带有效签名的主体头；密钥经环境变量 `ZHIN_GATEWAY_SECRET` 在拉起时传入，实例只监听 `127.0.0.1` 的随机端口（`ZHIN_INSTANCE_PORT`，由网关分配）。

额外监听端口（`createHttpHostGroup` 的 additional listeners，供需要独立端口的适配器使用）保留在实例，直接对外，不经网关。

### 3. 控制通道

网关与实例之间用 Node 子进程 IPC（`spawn(..., { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })`）。消息均为 `{ type, id?, payload }`：

| 方向 | 类型 | 说明 |
|---|---|---|
| 实例 → 网关 | `ready` | 监听完成：`{ port, version, plugins, generation }` |
| 实例 → 网关 | `restart-request` | 需要整进程重启的变更（`restart-process` effect、`disable_plugins`、数据库切换、Agent 自我变更）：`{ reason }`。**取代退出码 75** |
| 网关 → 实例 | `shutdown` | 优雅关闭：`{ reason, budgetMs }` |
| 网关 → 实例 | `principal-revoked` | 某主体被吊销：实例断开该主体的 SSE |

日志：网关采集实例 stdout / stderr，写入 `.zhin/logs/instance.log`（按大小轮转）并保留内存环形缓冲，供 `gateway.instance.logs` 与实例离线时查看。

**独立模式**：没有 IPC 通道时（直接 `zhin runtime start`，开发调试、自定义容器入口、现有部署），实例按今天的方式自己监听对外端口、自己认证（ADR 0049 的数据库鉴权在实例内运行）。同一套代码，两种装配。

### 4. 依赖管理（网关）

`gateway.packages.plan | install | uninstall | update`（`plugin.manage`；初始化阶段用初始化令牌仅允许数据库驱动，见 ADR 0053 §3）复用现有项目级事务 `PluginManagementPort`（`basic/cli/src/plugin-management/workflow.ts`：revision 校验、包管理器执行、清单 / 配置写入、失败回滚），网关额外负责实例的停启：

1. 生成计划并校验白名单与 revision；备份 `package.json`、锁文件、配置文件；
2. 向实例发送 `shutdown`，等待退出；
3. 执行事务，输出以 SSE（`gateway.packages.progress`）推给 Console；
4. 启动实例，等待 `ready`（默认 60 秒，`gateway.readyTimeout`）；
5. 失败：恢复备份、重新安装、启动旧版本；向 Console 报告失败阶段与日志尾部。

插件配置的 Schema 校验发生在实例启动后（实例里才有插件 Schema），失败视为第 4 步失败。

### 5. 实例生命周期

`gateway.instance.status | start | stop | restart | logs`：`status`、`logs` 需 `status.view`，其余需 `ops.restart`。

- 状态：`stopped | starting | running | stopping | backoff | crashed`；附 pid、启动时间、`generation`、最近退出码、最近一次失败的日志尾部。
- 崩溃重启沿用现有风暴保护（每分钟 10 次、间隔 3 秒）；超限进入 `crashed`，等人处理。
- 开发模式（`zhin dev` / `pnpm dev`）：网关以开发参数拉起实例，实例内的 HMR 不变。

### 6. CLI

| 命令 | 网关在运行 | 网关未运行 |
|---|---|---|
| `zhin start [--daemon]` | 提示已在运行 | 启动网关与实例 |
| `zhin stop` / `restart` / `status` / `logs` | 经本地控制套接字请求网关 | `stop`/`restart` 无事可做；`status` 显示未运行；`logs` 读日志文件 |
| `zhin install` / `uninstall` / `update` | 经网关执行（保证实例正确停启） | 直接执行同一事务 |
| `zhin console init` / `zhin console user …` | 直接操作项目数据库（ADR 0049 §7） | 同左 |

本地控制套接字：`.zhin/gateway.sock`（Windows：`\\.\pipe\zhin-gateway-<项目路径哈希>`），文件权限仅限当前用户，连接者视为本机 `owner`。

### 7. 数据

- 网关自己打开项目数据库（与实例同一份 `database` 配置），读写 `console_*` 表（ADR 0049）。实例在独立模式下才访问这些表。
- SQLite：两个进程同时连接，启用 `journal_mode=WAL` 与 `busy_timeout`。
- 数据库切换（ADR 0049 §7）：网关写配置、关闭自己的连接、重新打开新库，再重启实例。

### 8. 多实例

只支持一个项目一个实例。接口路径与内部模型以 `instanceId = 'default'` 表达，为将来一个网关管理多个实例留出位置，不实现。

## 对其他 ADR 的影响

| ADR | 落在哪个进程 | 说明 |
|---|---|---|
| 0049 RBAC | 网关（认证、`/auth/*`、`iam.*`、审计写入）；实例（RPC 授权） | 独立模式下全部在实例 |
| 0050 三级功能配置 | 实例 | `feature.*` RPC 经网关代理 |
| 0051 终端 | 网关 | 实例崩溃时仍可用 |
| 0052 Console 导航 | — | 运维区新增「实例」页：状态、起停、日志、依赖 |
| 0053 引导 | 网关 | 在线安装走 §4 |

## 落盘位置

- 网关：`basic/cli/src/gateway/`（`gateway.ts` 装配、`instance-supervisor.ts`、`control-channel.ts`、`proxy.ts`、`local-socket.ts`、`packages-service.ts`、`instance-logs.ts`）
- 实例侧：`basic/cli/src/plugin-runtime/start/instance-channel.ts`（IPC、`restart-request`、受管模式下的回环监听与主体头校验）
- 主体头签名与校验：`@zhin.js/host-http`（`gateway-principal.ts`）
- CLI：`basic/cli/src/commands/`（`start`、`stop`、`restart`、`status`、`logs`）

## 后果

- Console 在实例崩溃、启动失败、依赖安装期间都可用，能看日志、能回滚。
- 依赖安装在实例停止时进行，原生模块不再被占用，装坏自动回滚。
- 多一个常驻进程（不运行插件）与一跳本机反向代理。
- `zhin runtime start` 保留为实例入口与独立模式；现有容器部署不受影响。CLAUDE.md 中「`zhin runtime start` 是唯一启动路径」更新为「实例入口唯一；`zhin start` 是受管启动」。
