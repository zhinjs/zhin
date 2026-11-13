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

### 0. 四个包

| 包 | 职责 | 依赖边界 |
|---|---|---|
| `create-zhin-app` | 初始化 Zhin 项目（ADR 0053 §1） | 只依赖 `@zhin.js/scaffold-wizard` |
| `@zhin.js/cli`（`zhin` 命令） | 管理项目：`start / stop / restart / status / logs`、`install / uninstall / update`、`console init / user`、`setup`、插件开发工具（`new`、`build`、`pub`、`doctor` 等）。网关在运行时经本地套接字调用网关；不在运行时直接操作项目文件与数据库 | 依赖 `@zhin.js/gateway`（拉起网关、复用其服务），**不依赖 IM 层** |
| `@zhin.js/gateway`（新，`packages/host/gateway`） | 管理网关进程：HTTP 服务器、认证与 RBAC、初始化与引导、实例监管、依赖事务、终端、日志、本地套接字 | 依赖 `host-http`、`database`、`console-protocol`、`runtime`（仅配置与项目文件工具）、`scaffold-wizard`（驱动 / 适配器 / AI 定义）；**不依赖 `zhin.js` 与 IM 层**，按项目解析实例入口后以子进程拉起 |
| `zhin.js` | Zhin 实例：IM Runtime、插件、适配器、Agent，以及实例的装配根（原 `basic/cli/src/plugin-runtime/` 的启动装配与运行时侧 Console 后端迁入）。入口 `zhin.js/instance`，只能由网关拉起 | 现有 IM 层；HTTP 只通过 `BridgedHttpHost`（`@zhin.js/host-http/bridge`） |

- 网关与实例之间的 IPC 协议（消息类型、版本号）定义在 `@zhin.js/host-http/bridge`，两边共用；`ready` 消息携带协议版本，不兼容时网关拒绝并在 Console 提示升级。
- 网关和实例可以独立升级：网关解析项目 `node_modules` 里的 `zhin.js/instance`，不打包实例代码。
- 新项目依赖：`zhin.js`、`@zhin.js/gateway`、`@zhin.js/cli`。
- CLAUDE.md 中「`basic/cli` 是装配根、可导入 IM 层」的例外改为「`zhin.js` 的实例装配根」；`@zhin.js/cli` 与 `@zhin.js/gateway` 不得导入 IM 层（`check:architecture` 增加规则）。

### 1. 两个进程

| | 网关（Gateway） | 实例（Instance） |
|---|---|---|
| 启动 | `zhin start`（`pnpm dev` 即 `zhin start --foreground --watch …`）拉起 `@zhin.js/gateway` 常驻进程（取代现有 supervisor） | 只能由网关拉起；入口 `zhin.js/instance` |
| 职责 | 唯一对外端口；**认证**（会话、API 令牌、初始化令牌）；初始化与引导；实例起停、崩溃重启、日志采集；依赖安装 / 卸载 / 升级；原始配置文件与 `.env` 读写（实例离线时）；终端；审计；本地 Console 静态资源 | IM Runtime、插件、适配器、Agent、定时任务；**绝大部分 Console API**（依赖运行时快照）；插件自己的 HTTP / WS 路由 |
| 加载插件 | 否。可以使用 `@zhin.js/runtime`、`@zhin.js/database`、`@zhin.js/host-http` 等库做配置解析与项目文件操作，但不创建 Runtime、不执行插件代码 | 是 |
| 挂了怎么办 | 由系统服务（`zhin service install`）或容器重启 | 网关按策略重启；Console 照常可用，显示实例状态与日志 |

### 2. 实例不含 HTTP 服务器：路由在实例声明，由网关承载

实例进程不再监听任何端口，也不依赖 `node:http` / `ws`。插件、适配器、Console 后端仍然注册 HTTP 与 WebSocket 路由，但路由表通过控制通道交给网关，由网关唯一的 HTTP 服务器接收请求、转发给实例处理。

为此，`@zhin.js/host-http` 的路由契约改为**与传输无关**的 Web 标准形式（不再暴露 Node 的 `IncomingMessage` / `ServerResponse` / 原始 `WebSocket`）：

```ts
type HttpHandler = (request: Request, context: RouteContext) => Response | Promise<Response>;

interface RouteContext {
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly principal?: ConsolePrincipal;    // 网关认证后的主体（{base} 下的路由）
  readonly remoteAddress?: string;
}

interface WsConnection {
  readonly url: URL;
  readonly headers: Headers;
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  onClose(listener: (code: number, reason: string) => void): () => void;
  readonly bufferedAmount: number;          // 背压
}

interface HttpHost {
  route(method: string, path: string, handler: HttpHandler, meta?: RouteMeta): HttpRouteRegistration;
  ws(path: string, options?: WsRouteOptions): WsHandle;   // onConnection(conn: WsConnection)
  listRoutes(): readonly ListedRoute[];
}
```

- `Request` / `Response` / `Headers` / `ReadableStream` 是 Node 22 内置的 Web 标准对象；SSE 与大文件用流式 `Response` 体。
- 网关侧：Node `http` 请求 ↔ `Request` / `Response` 的转换，以及 `ws` ↔ `WsConnection` 的转换，集中在网关。
- 实例侧：`BridgedHttpHost` 实现同一个 `HttpHost` 接口；请求、响应体、WebSocket 帧都作为控制通道消息传输（流式分块，带背压）。
- 所有现有使用者一次性迁移到新契约：`basic/cli` 的 Console 路由、`packages/host/{http,mcp,a2a}`、`packages/im/{core,runtime}`、`packages/console/pagemanager`、全部适配器与插件。不保留旧签名。
- 额外监听端口（`createHttpHostGroup` 的 additional listeners，供要求独立端口的适配器）也由网关打开，路由同样转发给实例。

### 3. 请求流与控制通道

**请求流**（网关唯一的 HTTP 服务器，监听 `http.port`，`http.base` 默认 `/api`）：

1. **网关自有路由**——网关直接处理：`{base}/auth/*`（含初始化，ADR 0049）、`{base}/gateway/*`（§4、§5）、`{base}/console/terminal*`（ADR 0051）、`/pub/health`、本地 Console 静态资源。
2. **实例注册的 `{base}/*` 路由**（Console RPC、SSE、REST、MCP、A2A）——网关先认证（会话 / API 令牌 → 主体、权限、作用域绑定），未认证 401；实例离线 `503 { code: 'instance_unavailable', state }`（带 `Retry-After`）；实例在期限内没有响应 `504 { code: 'instance_timeout' }`；其他桥接失败（实例处理出错、流过多）`502 { code: 'instance_error' }`；认证通过后连同主体一起转发给实例。
3. **实例注册的其他路由**（适配器 Webhook、反向 WS 等）——不认证，原样转发，鉴权由插件自己负责，与今天一致。

**认证只在网关**（B1.4）：会话、API 令牌与初始化令牌都由网关在自己的数据库连接上解析；实例的令牌表是“关闭”的——不认开放 Host、不认初始化令牌、不解析任何 bearer，权限只来自随请求转发的主体（开放 Host 时网关转发 `{ kind: 'bootstrap', open: true }`，初始化令牌转发 `{ kind: 'bootstrap', open: false }`）。实例自己的协议面（MCP / A2A）按转发主体判断 `mcp.access` / `a2a.access`。早期的过渡消息 `auth.authenticate` / `auth.result` / `auth.state` / `auth.audit` 已删除（协议版本 3）。

**授权在处理处完成**：实例的 Console RPC 分发点按 `CONSOLE_RPC_PERMISSIONS`（ADR 0049 §3）检查随请求转发的主体——只有分发点知道 RPC 类型与载荷里的作用域目标。网关自有路由由网关检查。两边用 `@zhin.js/host-http` 的同一个访问控制模块与同一份权限表。控制通道只存在于父子进程之间，主体随消息传递，不需要签名。

**控制通道**：Node 子进程 IPC（`spawn(..., { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced' })`，可直接传 `Uint8Array`）。消息为 `{ type, id?, payload }`：

| 方向 | 类型 | 说明 |
|---|---|---|
| 实例 → 网关 | `ready` | `{ version, generation, routes, wsRoutes }` |
| 实例 → 网关 | `routes` | 路由表变化（插件重载、世代切换） |
| 网关 → 实例 | `http.request` / `http.body` / `http.abort` | 请求头与流式请求体 |
| 实例 → 网关 | `http.response` / `http.body` / `http.end` | 响应头与流式响应体 |
| 双向 | `ws.open` / `ws.message` / `ws.close` / `ws.drain` | WebSocket 连接与帧 |
| 实例 → 网关 | `restart-request` | 需要整进程重启的变更（`restart-process` effect、`disable_plugins`、数据库切换、Agent 自我变更）。**取代退出码 75** |
| 网关 → 实例 | `shutdown` | `{ reason, budgetMs }` |
| 网关 → 实例 | `principal-revoked` | `{ principalId, reason? }`：用户被禁用 / 删除、改密或绑定变化（ADR 0049 §6）后，实例关闭该用户（`userId`）经桥接打开的 SSE 与 WS（WS 关闭码 4401）。终端会话在网关本地，由网关直接结束 |
| 实例 → 网关 | `catalog` | `{ pluginPermissions }`：当前世代的插件权限目录（ADR 0049 增补），监听时与每次变化（世代提交）时上报；网关缓存（实例重启期间沿用上一份），用于 `/auth/me` 的等级展开、`iam.roles.list` 与网关自己的授权 |
| 实例 → 网关 | `audit` | `{ entry }`：实例侧写的审计条目（RPC 分发点的拒绝与写操作）；审计日志归网关所有，网关写入 |

**日志**：网关采集实例 stdout / stderr，写入 `.zhin/logs/instance.log`（按大小轮转），并保留内存环形缓冲，供 `gateway.instance.logs` 与实例离线时查看。

**只有受管模式**：实例入口 `zhin.js/instance` 在没有控制通道时拒绝启动并提示使用 `zhin start`。`zhin runtime start` 保留为 `zhin start --foreground` 的别名（见 §6），不再是独立模式；不保留退出码 75 重启。`--standalone`（实例自带 HTTP 服务器、无网关）只用于测试与开发。

### 4. 依赖管理（网关）

`gateway.packages.plan | install | uninstall | update`（`plugin.manage`；初始化阶段用初始化令牌仅允许数据库驱动，见 ADR 0053 §3）复用现有项目级事务 `PluginManagementPort`（`packages/host/gateway/src/plugin-management/workflow.ts`：revision 校验、包管理器执行、清单 / 配置写入、失败回滚），网关额外负责实例的停启。这是安装、更新、卸载依赖的唯一路径：实例内的 `plugin:install | update | uninstall` 已删除（实例只保留只读的 `plugin:plan-*`），Console 的市场与插件详情同样调用 `gateway.packages.*`：

1. 生成计划并校验白名单与 revision；备份 `package.json`、锁文件、配置文件；
2. 向实例发送 `shutdown`，等待退出；
3. 执行事务，输出以 SSE（`gateway.packages.progress`）推给 Console：网关接管 `GET {base}/events`，实例在线时转发实例的事件流并在帧边界插入网关帧（网关帧不带 `id:`，续传游标仍是实例的），实例离线时给只含网关事件的流（实例就绪后关闭，Console 重连回合并流），`{base}/events/history` 离线时返回保留调用方游标的空页；`GET {base}/gateway/packages/progress`（`plugin.manage`）只推进度；
4. 启动实例，等待 `ready`（默认 60 秒；项目配置 `gateway.readyTimeout`，整数秒 1–3600，同时用于网关平时启动 / 重启实例；网关在每次启动、重启实例与每笔事务前重新读取，改了不必重启网关）；
5. 失败：恢复备份、重新安装、启动旧版本；向 Console 报告失败阶段与日志尾部。

插件配置的最终校验发生在实例启动后，失败视为第 4 步失败。网关在事务内先用包自带的 `schema.json` 预检：

- `install` 声明新插件前用 Schema 默认值补全空配置并校验；有无默认值的必填字段（或引用缺失的环境变量）时只安装依赖、不声明，事务成功，结果带 `needsConfiguration`（缺少的配置路径与环境变量），实例不会因缺配置而回滚整笔安装。
- `gateway.plugins.declare { package, instanceKey?, config, startInstance? }`（`plugin.manage`；非所有者只能声明白名单内的包）是声明已安装插件并写入首份配置的唯一受支持入口：先在停实例前校验（包须是已安装的生产依赖、实例键未声明且非保留键、配置通过插件 Schema 且无缺失环境变量，否则 `invalid_input`；Schema 校验失败时回复除 `error` 文本外另带结构化 `errors: [{ path, message }]`（`path` 相对实例块，`$` 加 `.键/索引`，如 `$.endpoints.0.id`）与 `missingEnv: string[]`，仅非空时出现，类型见 `GatewayRpcErrorDetails`，本地 socket 的错误行同形），再作为事务执行（`snapshot → stop-instance → configure → start-instance`），一次原子写入 `plugins.<instanceKey>` 与实例块；启动失败时恢复配置文件（不重新安装依赖）并启动旧实例。进度同样经 `gateway.packages.progress` 推送，`operation` 为 `declare`。`config:patch-project` 仍拒绝修改声明。已安装但未声明的插件（`needsConfiguration`）可用 `schema:get { pluginName: <包名> }` 读取其 `schema.json` 表单（只读，须是生产依赖且为 Plugin 包），形状与已声明实例相同并带 `declared: false`。
- `gateway.plugins.enable { plugin, startInstance? }` / `gateway.plugins.disable { plugin, startInstance? }`（`plugin.manage`；非所有者只能启停白名单内的包，`./` 本地插件只限所有者）把一个已声明实例移出或加入 `disable_plugins`（`plugin` 为实例键，或只声明一次的包名）。先在停实例前校验（未声明、保留键、项目根插件一律 `invalid_input`；`enable` 另要求包已安装、依赖可解析、实例配置通过插件 Schema，失败时与 `declare` 同样带 `errors` / `missingEnv`），再作为只写配置的事务执行（`snapshot → stop-instance → configure → start-instance`），启动失败时恢复配置文件并启动旧实例。已是目标状态时直接成功、不停实例、不写文件。结果带 `plugin: { instanceKey, packageName, enabled, changed }`。CLI 的 `zhin enable` / `zhin disable` 在网关运行时经本地 socket 调用它们，否则直接写配置。
- 回滚报告的 `logTail` 只含本次事务期间实例输出的行。

### 5. 实例生命周期

`gateway.instance.status | start | stop | restart | logs`：`status`、`logs` 需 `status.view`，其余需 `ops.restart`。

- 状态：`stopped | starting | running | stopping | backoff | crashed`；附 pid、启动时间、`generation`、最近退出码、最近一次失败的日志尾部。
- 崩溃重启沿用现有风暴保护（每分钟 10 次、间隔 3 秒）；超限进入 `crashed`，等人处理。
- 开发模式（`pnpm dev`，即 `zhin start --foreground --watch source config`）：网关以开发参数拉起实例，实例内的 HMR 不变。`zhin dev` 是本地插件 link / unlink 工具，与启动无关。

### 6. CLI

| 命令 | 网关在运行 | 网关未运行 |
|---|---|---|
| `zhin start [--foreground]` | 提示已在运行 | 启动网关与实例：默认后台运行（等网关就绪后返回，网关日志写 `.zhin/logs/gateway.log`）；`--foreground`（`-f`）前台运行，Ctrl+C 同时停止两者。`zhin runtime start` 是 `zhin start --foreground` 的别名；`--daemon` 仍接受（即默认行为） |
| `zhin stop` / `restart` / `status` / `logs` | 经本地控制套接字请求网关 | `stop`/`restart` 无事可做；`status` 显示未运行；`logs` 读日志文件 |
| `zhin install` / `uninstall` / `update` | 经网关执行（保证实例正确停启） | 直接执行同一事务 |
| `zhin console init` / `zhin console user …` | 直接操作项目数据库（ADR 0049 §7） | 同左 |

生产模板（systemd / Docker / PM2 服务文件）与脚手架的 `pnpm start` 使用 `zhin start --foreground`：进程管理器需要一个不退出的前台进程；后台模式面向在终端里直接操作的用户。`--standalone`（实例在本进程内自带 HTTP 服务器、无网关）只用于测试与开发。

本地控制套接字：`.zhin/gateway.sock`（Windows：`\\.\pipe\zhin-gateway-<项目路径哈希>-<每次启动的随机串>`），文件权限仅限当前用户，连接者视为本机 `owner`。Node 不能给命名管道设 DACL：随机管道名与 `.zhin/gateway.json`（`0600`）里的握手密钥（`gateway.hello`，CLI 校验 HMAC）防止端点被抢占冒充。网关把实际端点（含 `os.tmpdir()` 回退路径）以 `ZHIN_GATEWAY_SOCKET` 传给实例，实例的 Agent 文件 / `bash` 工具拒绝触及它（按命令文本拦截，不约束同一系统用户下不受沙箱约束的插件代码）。`gateway.http.request` 走与 HTTP 相同的路由表；带显式 `ZHIN_CONSOLE_TOKEN` 时按该令牌认证并以其主体执行与审计。

### 7. 数据

- 网关自己打开项目数据库（与实例同一份 `database` 配置），读写 `console_*` 表（ADR 0049）；实例不访问这些表。
- SQLite：两个进程同时连接，启用 `journal_mode=WAL`（`@zhin.js/database` 对文件库总是开启）；两个连接都不设 `busy_timeout`——`node:sqlite` 的等待是同步的，会卡住整个事件循环（实例的长异步事务持锁时，网关的每个请求都会停顿）——而由 SQLite 方言对事务外语句与 `BEGIN IMMEDIATE` 遇到 `SQLITE_BUSY` 时做有界的异步退避重试（`busyRetryMs`，实例默认 5 秒，网关 5 秒）；网关的写入都是单语句自动提交（不开事务），持锁时间最短，预算用尽时网关返回 `503 { code: 'database_busy' }` 与 `Retry-After`，认证时的簿记写入（会话续期、令牌最近使用）遇忙则跳过。写事务以 `BEGIN IMMEDIATE` 开始，写锁在开头拿到，不会在事务中途遇到 `SQLITE_BUSY_SNAPSHOT`；声明为只读的事务（`transaction(cb, { readOnly: true })`）以 `BEGIN DEFERRED` 开始且 `query_only`，不拿写锁。插件运行时的 Database Host 事务接口无法声明只读，仍按写事务处理。
- 配置解析：网关按实例 `resolveDatabaseConfig` 的同一规则解析 `database`（`@zhin.js/gateway/database`，不导入 IM 层），相对 SQLite 路径以项目根为准；数据库不可用时网关照常监听，`/auth/*` 返回 503，“是否已初始化”取初始化标记文件（失败即关闭），并定时重试。
- 数据库切换（ADR 0049 §7）：网关写配置、关闭自己的连接、重新打开新库，再重启实例。

### 8. 多实例

只支持一个项目一个实例。接口路径与内部模型以 `instanceId = 'default'` 表达，为将来一个网关管理多个实例留出位置，不实现。

## 对其他 ADR 的影响

| ADR | 落在哪个进程 | 说明 |
|---|---|---|
| 0049 RBAC | 网关（认证、`/auth/*`、`iam.*`、初始化、审计写入）；实例（RPC 授权） | — |
| 0050 三级功能配置 | 实例 | `feature.*` RPC 经网关代理 |
| 0051 终端 | 网关 | 实例崩溃时仍可用 |
| 0052 Console 导航 | — | 运维区新增「实例」页：状态、起停、日志、依赖 |
| 0053 引导 | 网关 | 在线安装走 §4 |

## 落盘位置

- 网关：`packages/host/gateway/src/`（`gateway.ts` 装配、`instance-supervisor.ts`、`http-server.ts`、`local-socket.ts`、`packages-service.ts`、`instance-logs.ts`；ADR 0049 的 `iam/`、ADR 0051 的 `terminal/`、ADR 0053 的 `onboarding/` 从 `basic/cli` 迁入）
- 桥接与 IPC 协议、传输无关的路由契约：`@zhin.js/host-http`（`./bridge` 子路径）
- 实例：`packages/im/zhin/src/instance/`（装配根、`BridgedHttpHost` 接入、`restart-request`；运行时侧 Console 后端从 `basic/cli/src/plugin-runtime/console/` 迁入）
- CLI：`basic/cli/src/commands/`（`start`、`stop`、`restart`、`status`、`logs`、`install`、`uninstall`、`update`、`console`、`setup`）

## 后果

- Console 在实例崩溃、启动失败、依赖安装期间都可用，能看日志、能回滚。
- 依赖安装在实例停止时进行，原生模块不再被占用，装坏自动回滚。
- 多一个常驻进程（不运行插件）与一跳进程间转发。
- 实例没有 HTTP 服务器，不依赖 `node:http` / `ws`；HTTP 能力全部集中在网关。
- **破坏性变更**：HTTP 路由契约改为 Web 标准 `Request` / `Response` 与 `WsConnection`，所有插件与适配器同步迁移；`zhin runtime start` 不能再单独运行（它是 `zhin start --foreground` 的别名，同样拉起网关），部署改用 `zhin start --foreground`（容器入口同样）。CLAUDE.md 中「`zhin runtime start` 是唯一启动路径」更新为「`zhin start` 是唯一启动路径」。
