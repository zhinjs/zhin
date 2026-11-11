---
sidebar: false
---

# ADR 0054：管理网关——CLI 启动网关，网关管理 Zhin 实例

状态：Accepted（2026-11-11）

## 背景

`zhin runtime start` 的父进程（`NativeTypeScriptSupervisor`）只负责拉起子进程并在退出码 75 时重启；HTTP Host、Console、鉴权、配置写入、插件安装都在**子进程**——也就是 Zhin 实例本身——里。后果：

- 实例启动失败、崩溃、或正在重启时，Console 一起消失，没法在 Console 里看日志、改配置、回滚依赖；
- 依赖安装发生在运行中的实例里，原生模块被占用，装完必须让实例「自己重启自己」；装坏了，实例起不来，Console 也就没了；
- 访问控制（ADR 0049）、初始化与引导（ADR 0053）、终端（ADR 0051）是宿主层面的事，却挂在会被插件拖垮的进程里。

## 决策

### 1. 两个进程

| | 网关（Gateway） | 实例（Instance） |
|---|---|---|
| 启动 | `zhin start`（CLI） | 网关拉起：现有 `zhin runtime start` 入口，作为子进程 |
| 职责 | 对外 HTTP 端口；Console API 与 SSE；鉴权与 RBAC；初始化与引导；实例起停、崩溃重启、日志采集；依赖安装 / 卸载 / 升级；配置文件与 `.env` 读写；终端；审计 | IM Runtime、插件、适配器、Agent、定时任务；插件自己的 HTTP 路由（Webhook、反向 WS） |
| 加载插件 | 否（只依赖 `@zhin.js/cli`、`host-http`、`database`） | 是 |
| 挂了会怎样 | 由系统服务（`zhin install-service`）或容器重启 | 网关按策略重启；Console 照常可用，显示「实例已停止 / 启动失败」与日志 |

### 2. 单一对外端口

网关监听配置里的 `http.port`。路径分流：

- `{base}/auth/*`、`{base}/gateway/*`、`{base}/console/terminal*` 以及网关自有的 Console RPC：网关直接处理。
- 其余 Console RPC（状态、账号、功能配置、日志查询等运行时数据）：网关鉴权后，经控制通道转发给实例；实例未运行时返回 `503 { code: 'instance-offline' }`。
- 其他所有路径（插件 / 适配器的 HTTP 与 WebSocket 路由）：网关透明反向代理到实例的回环端口（`127.0.0.1:<随机端口>`，由网关分配并通过环境变量告诉实例）。这些路由的鉴权仍由插件自己负责，与今天一致。

实例不再对外监听。

### 3. 控制通道

网关与实例之间用 Node 子进程 IPC 通道（`spawn(..., { stdio: [..., 'ipc'] })`），不走网络：

- 网关 → 实例：`rpc`（转发的 Console RPC，附带已鉴权的主体与权限，实例信任它）、`shutdown`、`reload`。
- 实例 → 网关：`ready`（含回环端口与能力信息）、`status`、`event`（SSE 事件转发）、`log`。
- 没有 IPC 通道（直接 `zhin runtime start`，如开发调试、自定义容器入口）时，实例按今天的方式自己起 HTTP Host，作为「独立模式」。

### 4. 依赖管理（网关独有）

`gateway.packages.install | uninstall | upgrade`（RPC，`plugin.manage`；初始化阶段仅允许数据库驱动，见 ADR 0053 §3）：

1. 校验白名单，备份 `package.json` 与锁文件；
2. 停止实例（优雅关闭）；
3. 在项目根执行包管理器，输出流式推给 Console；
4. 启动实例并等待 `ready`（超时可配，默认 60 秒）；
5. 启动失败：恢复 `package.json` 与锁文件、重新安装、再启动旧版本，向 Console 报告失败原因与日志。

CLI 的 `zhin install | uninstall | update` 执行同一个服务：检测到网关在运行，就通过网关执行（保证实例被正确停启）；没有网关就直接操作项目文件。

### 5. 实例生命周期

`gateway.instance.status | start | stop | restart | logs`（RPC；`status` 需 `status.view`，其余需 `ops.restart`）：

- 状态：`stopped | starting | running | stopping | crashed | backoff`，含 pid、启动时间、最近退出码、最近一次失败的日志尾部。
- 崩溃重启沿用现有风暴保护（每分钟 10 次、间隔 3 秒）；超过后进入 `crashed`，等人处理。
- 实例里需要重启的配置变更（`restart-process` effect、`disable_plugins`、数据库切换）改为请求网关重启实例，而不是退出码 75。
- CLI：`zhin start`（网关 + 实例）、`zhin stop`、`zhin restart`、`zhin status`、`zhin logs` 在网关运行时通过本地控制套接字与网关通信（`.zhin/gateway.sock`，Windows 用命名管道；文件权限仅当前用户，等同本机 `owner`）。

### 6. 数据与鉴权

- 网关自己打开项目数据库（与实例同一个 `database` 配置），用于 `console_*` 表；实例照旧使用数据库。SQLite 启用 WAL 与忙等待，两个进程并发读写安全。
- 鉴权全部在网关完成；转发给实例的 RPC 已经过权限检查。

### 7. 多实例

本 ADR 只支持一个项目一个实例。接口按 `instances/default` 设计，为将来一个网关管理多个实例留出位置，但不实现。

## 对其他 ADR 的影响

- ADR 0049（RBAC）、0051（终端）、0053（引导）：落在网关进程。代码位置（`basic/cli/src/plugin-runtime/console/…`）不变，装配点从实例的 `start-command.ts` 移到网关。
- ADR 0050（三级功能配置）：解析与门禁在实例；`feature.*` RPC 经网关转发。
- ADR 0052（Console 导航）：运维区新增「实例」页（状态、起停、日志、依赖）。

## 落盘位置

- 网关：`basic/cli/src/gateway/`（进程管理、控制通道、反向代理、本地套接字、依赖管理服务）
- 实例侧控制通道：`basic/cli/src/plugin-runtime/start/instance-channel.ts`
- CLI 命令：`zhin start | stop | restart | status | logs | install | uninstall | update`

## 后果

- Console 在实例崩溃、启动失败、依赖安装期间都可用，能看日志、能回滚。
- 依赖安装在实例停止时进行，原生模块不再被占用，装坏可以自动回滚。
- 多了一个常驻进程（不加载插件，占用小）与一次 IPC 转发。
- `zhin runtime start` 保留为实例入口与独立模式，现有容器部署不受影响。
