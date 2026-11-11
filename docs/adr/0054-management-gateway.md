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
| 启动 | `zhin start` / `zhin dev` 拉起 `@zhin.js/gateway` 常驻进程（取代现有 supervisor） | 只能由网关拉起；入口 `zhin.js/instance` |
| 职责 | 唯一对外端口；**认证**（会话、API 令牌、初始化令牌）；初始化与引导；实例起停、崩溃重启、日志采集；依赖安装 / 卸载 / 升级；原始配置文件与 `.env` 读写（实例离线时）；终端；审计；本地 Console 静态资源 | IM Runtime、插件、适配器、Agent、定时任务；**绝大部分 Console API**（依赖运行时快照）；插件自己的 HTTP / WS 路由 |
| 加载插件 | 否。可以使用 `@zhin.js/runtime`、`@zhin.js/database`、`@zhin.js/host-http` 等库做配置解析与项目文件操作，但不创建 Runtime、不执行插件代码 | 是 |
| 挂了怎么办 | 由系统服务（`zhin install-service`）或容器重启 | 网关按策略重启；Console 照常可用，显示实例状态与日志 |

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
2. **实例注册的 `{base}/*` 路由**（Console RPC、SSE、REST、MCP、A2A）——网关先认证（会话 / API 令牌 → 主体、权限、作用域绑定），未认证 401；实例离线 `503 { code: 'instance-offline', state }`；认证通过后连同主体一起转发给实例。
3. **实例注册的其他路由**（适配器 Webhook、反向 WS 等）——不认证，原样转发，鉴权由插件自己负责，与今天一致。

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
| 网关 → 实例 | `principal-revoked` | 实例断开该主体的 SSE / WS |

**日志**：网关采集实例 stdout / stderr，写入 `.zhin/logs/instance.log`（按大小轮转），并保留内存环形缓冲，供 `gateway.instance.logs` 与实例离线时查看。

**只有受管模式**：实例入口 `zhin.js/instance` 在没有控制通道时拒绝启动并提示使用 `zhin start`。`zhin runtime start` 删除；不保留独立模式与退出码 75 重启。

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

- 网关自己打开项目数据库（与实例同一份 `database` 配置），读写 `console_*` 表（ADR 0049）；实例不访问这些表。
- SQLite：两个进程同时连接，启用 `journal_mode=WAL` 与 `busy_timeout`。
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
- **破坏性变更**：HTTP 路由契约改为 Web 标准 `Request` / `Response` 与 `WsConnection`，所有插件与适配器同步迁移；`zhin runtime start` 不能再单独运行，部署改用 `zhin start`（容器入口同样）。CLAUDE.md 中「`zhin runtime start` 是唯一启动路径」更新为「`zhin start` 是唯一启动路径」。
