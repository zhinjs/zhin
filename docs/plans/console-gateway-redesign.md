---
sidebar: false
---

# Console 与管理网关重构——实施计划

> 内部工作文档（`docs/plans/` 不发布）。本文件同时是进度的唯一记录：每推进一步，更新「进度」一节并随代码提交。

## 目标

1. **Console = 状态查看 + 功能配置后台**：功能配置分全局 < 适配器 < 账号三级，插件声明支持的层级；启停自上而下（上级禁用下级不能开），其他配置自下而上（账号 > 适配器 > 全局）。
2. **运维体系独立**：实例、依赖、数据库、配置文件、环境变量、定时任务、文件、终端（本机 Shell / SSH）。
3. **正规 RBAC**：用户、角色、权限、会话、API 令牌、审计存在数据库；`http.token` 只用于首次初始化；`http.tokens` 与演示模式移除。
4. **初始化统一**：CLI（`zhin console init`）与 Console Web 执行同一套动作；`create-zhin` 只建项目，数据库 / AI / 适配器在 Console 引导中完成。
5. **四个包、两个进程**：`create-zhin-app` 初始化项目；`@zhin.js/cli` 管理项目；`@zhin.js/gateway` 是管理网关进程（HTTP、鉴权、实例监管、依赖、终端）；`zhin.js` 是实例（不含 HTTP 服务器）。实例崩溃时 Console 仍可用。

## 契约

| ADR | 主题 |
|---|---|
| [0049](../adr/0049-console-rbac.md) | 访问控制：数据表、权限目录、内置角色、`/auth/*`、`iam.*`、初始化服务（CLI / Web 同源）、审计 |
| [0050](../adr/0050-layered-feature-config.md) | 三级功能配置：`x-zhin-config.levels`、`overrides`、解析规则、`configFor`、分发门禁、`feature.*` |
| [0051](../adr/0051-console-terminal.md) | 终端：配置、权限、票据 + WebSocket 协议、审计 |
| [0052](../adr/0052-console-information-architecture.md) | Console 导航六分区与功能区路由 |
| [0053](../adr/0053-console-onboarding.md) | create-zhin 精简与 Console 引导、在线安装白名单 |
| [0054](../adr/0054-management-gateway.md) | 管理网关：网关认证 + 代理、实例授权、IPC、依赖事务、生命周期、CLI |

契约之间的进程归属以 ADR 0054「对其他 ADR 的影响」为准。

## 工作流与依赖

```text
M0 契约 ──┬─ A1 RBAC 后端 ───────────────────┐
          ├─ A2 三级配置后端 ────────────────┤
          ├─ A3 终端后端 ────────────────────┼─ M2 集成批 1（zhin PR-1 / console PR-1）
          ├─ A4 Console 导航重构 ────────────┤        │
          └─ A5 create-zhin 精简 ────────────┘        │
                                                      ├─ B1 管理网关 ─┬─ B2 引导后端 ─┐
                                                      │               │               ├─ M4 集成批 2（zhin PR-2）
                                                      │               └───────────────┘        │
                                                      └─ 发布（main 合并后 Changesets 自动发版）─┤
                                                                                               ├─ C1–C4 Console 第二阶段（console PR-2…）
                                                                                               └─ M6 文档与迁移 → M7 端到端验收
```

## 里程碑与验收

### M0 契约（完成）

ADR 0049–0054 与本计划。

### M1 第一阶段（并行）

| 编号 | 内容 | 范围 | 验收 |
|---|---|---|---|
| A1 | RBAC 后端（先在实例进程内装配，B1.4 迁到网关） | `console-protocol/permissions.ts`、`host-http` 访问控制、`basic/cli/.../console/iam/`、`basic/database` 探测、`zhin console init/user` | 权限表覆盖全部 RPC（门禁测试）；登录、限速、吊销、最后所有者、初始化 409；`http.tokens` / 演示代码删除；CLI 与 Web 初始化走同一服务的测试 |
| A2 | 三级配置后端 | `runtime`（解析器、`levels`、`overrides`）、`plugin-runtime`（`configFor`/`isEnabledFor`）、`core` 分发门禁、`agent` 工具门禁、`feature.*` RPC | 解析语义测试（上级禁用锁定、`null` 清空、数组替换）；四条分发路径门禁测试；只改覆盖原地生效 |
| A3 | 终端后端 | `basic/cli/.../console/terminal/` | 已完成：35 项测试；待接线 |
| A4 | Console 导航重构（现有接口） | `zhinjs/console` | 六分区、旧路由重定向、演示模式删除；`tsc`、`npm test`、`farm build` 通过；截图自检 |
| A5 | create-zhin 精简 | `packages/toolkit/create-zhin` | 交互只剩语言 / 项目名 / 令牌；参数仍生效；Console 链接格式测试 |

### M2 集成批 1

- 接线：权限表补齐 A2 / A3 的 RPC 与路由；`feature.*` 授权钩子接 RBAC 作用域；终端接 `installConsoleTerminal`；`host-config-schema.json` 加 `console.terminal`，删除 `http.tokens`。
- 依赖：重建锁文件（`node-pty`、`ssh2` 可选依赖等）。
- Changesets：每个改动的发布包一条。破坏性变更（`http.tokens` 与演示模式删除、`http.token` 变为初始化令牌、HTTP 路由契约、create-zhin 交互、`zhin start`）所在的包用 **minor**，说明里写迁移步骤；**任何包都不允许出现 major**，`zhin.js` 主包不能因子包 minor 被连带升大版本。
  - 现状：`.changeset/config.json` 已开 `onlyUpdatePeerDependentsWhenOutOfRange`，`zhin.js` 对子包的 peer 是 `workspace:^`。2026-11-11 实测：10 个子包标 minor 时计划内 0 个 major，`zhin.js` 只升 patch。
  - 要改的门禁：`scripts/check-release-plan.mjs` 目前禁止一切 minor。改为：`.changeset/version-policy.json` 的 `approvedNonPatchReleases` 列出允许 minor 的包（`[{ "package": "...", "type": "minor", "reason": "..." }]`），计划里出现未批准的 minor、或**任何** major（含连带升级）都失败；补测试。发版后清空批准列表。
- 文档：CLAUDE.md、`docs/console/`、配置参考、升级指南。
- 不考虑兼容：所有破坏性变更直接落地，迁移说明写进 changeset 与升级指南。
- 检查：`pnpm build`、`pnpm test`、`HARNESS_SEQUENTIAL=1 NODE_OPTIONS=--max-old-space-size=10240 pnpm check:all`。
- PR：zhin PR-1（后端 + create-zhin），console PR-1（导航重构）。console PR-1 不依赖新接口，可先合。

### M3 管理网关（B1）

| 步骤 | 内容 | 验收 |
|---|---|---|
| B1.-1 | 拆包：新建 `@zhin.js/gateway`（`packages/host/gateway`）；实例装配根与运行时侧 Console 后端从 `basic/cli/src/plugin-runtime/` 迁到 `zhin.js`（`src/instance/`）；`iam/`、`terminal/`、`onboarding/` 迁到网关；`@zhin.js/cli` 去掉 IM 层依赖；`check:architecture` 加规则；CLAUDE.md 更新 | 纯搬迁、行为不变；全量检查绿 |
| B1.0 | HTTP 路由契约改为 Web 标准 `Request`/`Response` + `WsConnection`（ADR 0054 §2）；迁移全部使用者（basic/cli Console 路由、host/http·mcp·a2a、im/core·runtime、console/pagemanager、20 个适配器、calendar 等插件）；先由现有进程内 Node 服务器承载，行为不变 | 全部适配器 / Console 路由测试通过；`check:all` 绿 |
| B1.1 | `instance-supervisor`：替换 `NativeTypeScriptSupervisor`，IPC 通道（advanced 序列化）、`ready`、`shutdown`、`restart-request`、风暴保护、日志采集与轮转；删除退出码 75 路径 | 单测（假子进程） |
| B1.2 | 实例侧 `BridgedHttpHost`：路由表上报、请求 / 响应体流式分块与背压、WS 帧、主体随请求传递；实例删除 Node HTTP 服务器，无控制通道时拒绝启动 | 桥接单测（流式、中断、背压、WS）；实例进程不加载 `node:http` |
| B1.3 | 网关 HTTP：Node 请求 ↔ `Request`/`Response`、`ws` ↔ `WsConnection`；自有路由分流、`{base}` 认证后转发（含 SSE）、其他路由原样转发、额外监听端口、实例离线 503 | 集成测试：真实网关 + 假实例 |
| B1.4 | 认证迁移：`/auth/*`、`iam.*`、初始化服务、终端、审计在网关装配；网关打开项目数据库（SQLite WAL） | 网关单进程起、无实例时 Console 能登录 / 初始化 |
| B1.5 | 依赖事务：`gateway.packages.*` 复用 `PluginManagementPort`，停实例 → 执行 → 起实例 → 失败回滚 | 失败回滚测试（假包管理器 + 起不来的实例） |
| B1.6 | 生命周期 RPC 与 CLI：`gateway.instance.*`；`zhin start/stop/restart/status/logs` 经本地套接字；`zhin install/uninstall/update` 网关在时走网关 | CLI 测试（套接字权限、无网关回退） |
| B1.7 | 端到端：`examples/minimal-bot` 用 `zhin start` 启动，重启、崩溃、安装失败回滚 | 进程级测试（标记为慢测，CI 跑一次） |

### M4 引导后端（B2）与集成批 2

- `.zhin/onboarding.json`、`GET /auth/setup` 的 `onboarding` 字段、`onboarding.update`；
- 安装白名单（数据库驱动、适配器、AI 依赖、市场条目）；初始化令牌只允许数据库驱动；
- `zhin setup` 第 3、4 步调用同一服务；已有项目自动标记已完成步骤；
- zhin PR-2（网关 + 引导），检查同 M2。合并后等待 Changesets 发版。

### M5 Console 第二阶段（发版后）

| 编号 | 内容 |
|---|---|
| C1 | 登录（用户名密码）、初始化向导（数据库 → 所有者）、引导流程（AI、适配器）、个人设置（改密码、我的令牌） |
| C2 | 访问控制区：用户、角色（权限勾选、作用域绑定）、API 令牌、审计日志 |
| C3 | 功能区：矩阵接 `feature.matrix`；全局 / 适配器 / 账号配置页的继承徽标、移除覆盖、锁定开关 |
| C4 | 运维区：实例页（状态、起停、日志、依赖安装进度）、终端（xterm.js） |

每项一个 console PR；接口未发版前用本地 `pnpm link` 的 zhin 验证。

### M6 文档与迁移

- 升级指南：初始化步骤、`http.tokens` 迁移到用户 / API 令牌、自动化改用 API 令牌、`zhin start` 与 `zhin runtime start` 的区别。
- 演示站点：一台真实 Host + 只读 `viewer` 账号的部署说明（替代演示模式）。
- 终端安全提示（等同宿主 Shell、SSH 指纹固定）。

### M7 端到端验收

在容器里从零走一遍：`create-zhin` → `zhin start` → Playwright 打开本地构建的 Console → 初始化（SQLite）→ 创建所有者 → 引导安装一个适配器（沙盒适配器）→ 三级配置覆盖生效 → 终端执行命令 → 安装失败回滚。截图附在 PR。

## 进度

状态：`todo` / `doing` / `review`（PR 已开）/ `done`（已合并）/ `blocked`（附原因）。

| 项 | 状态 | 备注 |
|---|---|---|
| M0 契约 | done | ADR 0049–0054 已在 `feat/friendly-volta-ejc3wl` |
| A1 RBAC 后端 | done | 已提交。偏差：无 `http.token` 且无所有者时 Host 保持开放（本地开发）；`/auth/me` 公开返回 `anonymous`；新增 `/auth/tokens` 自助令牌；登录限速返回 429；全局所有者对插件自定义页面权限视为不受限 |
| A2 三级配置后端 | done | 已提交；`feature.*` 接线与 `export * from './feature.js'` 交给 A1（同文件）。偏差：解析器在 `plugin-runtime`（core/agent 不能依赖 runtime）；覆盖字段校验为第二遍校验；`null` 清空即删除字段；插件自身 `enabled`、`commandNamespace`、`disabledCommands` 不可覆盖。待办：`basic/schema` 的 `Schema#levels()` 构建器（可选）；Console 整块保存插件配置时不能丢 `overrides`（C3 核对） |
| A3 终端后端 | done | 已提交，待 M2 接线 |
| A4 Console 导航重构 | done | [zhinjs/console#92](https://github.com/zhinjs/console/pull/92) 已合并。待办：zhin 侧页面元数据加 `section` 字段，`packages/console/client` 的 `resolveEntryRegister` 透传 `meta.section`（M2）；`feature.matrix` 返回形状已与 A2 对齐 |
| A5 create-zhin 精简 | done | 已提交；生成项目 README / 首页 / hello 模板（`scaffold-wizard/message-templates.ts`）里的首跑步骤留到 B1.6 随 `zhin start` 一起改 |
| M2 集成批 1 | done | [zhinjs/zhin#1226](https://github.com/zhinjs/zhin/pull/1226) 已合并（含 B1.-1）。终端接线、Host 配置 Schema、适配器反向 WS 改为自鉴权、页面 `section`、文档与升级指南、发版门禁（6 minor / 0 major，`zhin.js` patch）、锁文件、changesets；`check:all` 全过。偏差：终端会话按用户（`user:<id>`）吊销，单独吊销 API 令牌或改角色定义不断开会话。未验证：`check:created-project*`、真实 OneBot/NapCat/Milky 客户端、Windows 原生模块、真实 SSH |
| B1 管理网关 | done | B1.-1 拆包 done（`@zhin.js/gateway` 新包；装配根迁到 `zhin.js/instance`；CLI 无 IM 依赖）。B1.0 done（在 `feat/friendly-volta-ejc3wl`）：路由契约改为 Web 标准 `Request` / `Response` + `WsConnection`，Node 服务器在 `@zhin.js/host-http/node`，主体经 `context.principal` 传入，未预期错误只返回通用信息；`@zhin.js/host-http-contract` 按 minor 发布（已加入批准列表）。B1.1 done（在分支，已合并 `wt/b11`）：`InstanceSupervisor` + IPC 控制通道（`@zhin.js/host-http/bridge`），退出码 75 路径删除。临时边：`zhin.js/instance` 依赖 `@zhin.js/gateway`（配置存储、插件管理事务、IAM、终端、TSX 加载器、supervisor 辅助）。决定：配置存储与插件管理事务归网关所有，B1.4 起实例的 Console 配置 / 插件 RPC 改由网关处理，届时删除这条边。B1.2 done（在分支，已合并 `wt/b12`）：桥接协议 2（路由表、分块体与信用背压、WS 帧、主体转发），`BridgedHttpHost` / `IpcInstanceTransport`，实例无控制通道拒绝启动（`--standalone` 例外）。B1.3 done（在分支，已合并 `wt/b13`）：`GatewayHttpServer` / `startGateway`，`createNodeHttpListener`，改用 `@zhin.js/host-http/bridge` 的真实传输类型；转发失败映射为 `503 instance_unavailable`（`state` + `Retry-After`）/ `504 instance_timeout` / `502 instance_error`。B1.5 done（在分支，已合并 `wt/b15`）：`GatewayPackageService`、`gateway.*` RPC 契约与权限、`dispatchGatewayRpc`、Windows 命令解析。集成：`zhin runtime start` / `pnpm dev` 经 `runGateway` 启动网关（监听 `http.port`，`transport = supervisor.transport`，监听后 `setAddresses`），关闭了 B1.2 引入的“不带 `--standalone` 无法访问 HTTP”的临时回退；`POST {base}/console/request` 的 `gateway.*` 由网关处理、其余转发；网关服务器挪到 `@zhin.js/gateway/server`（`/http` 只留实例也用的响应工具）。B1.4 done（在分支，已合并 `wt/b14`）：网关自己打开项目数据库（`@zhin.js/gateway/database`，SQLite WAL），持有 `console_*` 表并本地认证；`/auth/*`、`iam.*`、`onboarding.update`、初始化向导（换库后网关重连并重启实例）、终端、审计在网关装配；受管实例不再装配 IAM；桥接协议 3 删除 `auth.*`，新增 `catalog`（插件权限目录）、`audit`（实例侧审计）、`principal-revoked`；网关接管 `{base}/events`（合并 `gateway.packages.progress`，实例离线时只含网关事件）与 `{base}/gateway/packages/progress`；SQLite 争用：网关写入为单语句自动提交，实例的 SQLite 方言对 `SQLITE_BUSY` 做有界异步退避重试（默认 5 秒），事务改为 `BEGIN IMMEDIATE`。B1.6 done（在分支，已合并 `wt/b16`）：`runGateway` 移到 `src/http/run-gateway.ts`，网关常驻（实例崩溃 / `crashed` / 停止都不退出，SIGINT / SIGTERM、`gateway.shutdown`、`--once` 才结束）；本地控制套接字 `.zhin/gateway.sock`（Windows 命名管道）与 `.zhin/gateway.json`（`@zhin.js/gateway/local`），经 `RunningGateway.rpc` 只到达 `gateway.*`；CLI `zhin start`（默认后台，`--foreground` 前台；所有者决定，ADR 0054 §6 已更新）、`stop` / `restart [--gateway]` / `status [--json]` / `logs [-f] [-n]` / `update`，网关运行时 `install` / `uninstall` 经网关；脚手架脚本与服务模板用 `zhin start --foreground`。B1.7 done（已合并 `wt/b17`）：进程级端到端 `tests/e2e-gateway`（`pnpm test:e2e:gateway`，`full-validation.yml` 的 `gateway-e2e` 任务）：启动、首次初始化、重启、崩溃与崩溃风暴、安装失败回滚、吊销断开、日志与停止。后续修复已合并（`wt/dbfix`）：网关 SQLite 异步遇忙重试与 `503 database_busy`、只读事务 `BEGIN DEFERRED`、`zhin console init/user` 与 `zhin setup --install` 网关运行时经本地套接字 |
| B2 引导后端 | done | 服务核心已合并（`wt/b2`）：引导状态、安装白名单、`authorizeInstall`、经依赖事务安装、`zhin setup` 非交互参数、`zhin console init` 记录步骤。HTTP / RPC 接线随 B1.4 完成：`GET /auth/setup` 与 `/auth/me`（`plugin.manage`）带 `onboarding`，`onboarding.update`（第 3 步另需 `agent.configure`、第 4 步另需 `endpoint.manage`），安装进度经 `gateway.packages.progress`（HTTP 接线 done，在分支） |
| 插件权限级别 + 插件 RPC 鉴权 | done | 已合并（`wt/perm` + `wt/rpcperm`，在分支）：插件权限按 read / operate / manage 授予内置角色，自定义角色与 API 令牌可写入插件权限；插件 RPC 对已登录用户按方法 / 页面 / 兜底权限逐一检查；适配器账号方法的授权目标与处理函数一致；rss / reminder / ledger / calendar / qrcode / short-url 补充级别声明 |
| M4 集成批 2 | done | 由 #1227 的分批集成完成（每批合并后 `pnpm build` + `check:all`） |
| C1–C4 | review | C1–C3：[zhinjs/console#93](https://github.com/zhinjs/console/pull/93)（tsc / 1049 测试 / 构建通过；接口类型本地镜像，发版后替换）。C4 等 B1.5/B1.6 |
| M6 文档与迁移 | done | 升级指南 `docs/migrations/management-gateway.md`、架构 / 仓库结构（四个包、两个进程）、新手上手、Console 页面（引导 / 访问控制 / 功能 / 运维）、演示站部署 `docs/operations/demo-deployment.md`（未实际部署），均含英文版 |
| M7 端到端验收 | done | `tests/e2e-gateway/console-acceptance.slow.test.ts`：按 Console 调用的接口走通初始化向导 → 沙盒适配器 → 三级配置开关 → 终端 → Console 发起的安装回滚（未用 Playwright 驱动 Console UI） |

## 推进方式

- 2026-11-11 起并行：B1.0 在主 checkout；B1.1（`wt/b11`）、B2 核心（`wt/b2`）、插件权限默认授予（`wt/perm`）与插件 RPC 鉴权（`wt/rpcperm`）在独立 worktree。2026-11-11 已按 B1.1 → B2 → 插件权限的顺序合并到 `feat/friendly-volta-ejc3wl`（合并提交，移植到 B1.0 契约）。

- 定时检查（每小时）唤醒本会话：读本节进度与后台任务结果 → 集成已完成的工作并跑检查 → 派发依赖已满足的下一项 → 更新本节并提交。
- 并行工作者只改各自路径，不做 git 写操作；集成、锁文件、Changesets、提交与 PR 由协调者完成。
- 不强推、不跳过测试；PR 进入合并队列后不再推送。
- 需要仓库所有者决定的事项记在下方，不阻塞其他项。

## 所有者已决定（2026-11-11）

1. 反向 WebSocket 未配 `access_token` 时只接受回环连接：按 patch 发布，保持现状。
2. 插件自定义权限：采用方案 A，内置角色按约定补上插件权限——`<plugin>:read` 类给 viewer 及以上，操作类给 operator 及以上，管理 / 审批类（如 `ops:approve`）给 admin。B1.0 完成后派发（与 IAM 路由同路径）。
3. `zhin` 别名包随本次发布（保留 `.changeset/zhin-shim-follow-cli.md`）。
4. 发版后由协调者清空 `.changeset/version-policy.json#approvedNonPatchReleases`（下一个 PR 里做）。

## 已知待办

- 从引导 / Console 安装适配器时默认 `enable: true` 会写入 `{}` 配置，账号字段必填的适配器 Schema 校验失败导致整笔回滚：处理中（`wt/adapterinstall`）。
- 安全修复处理中（`wt/sec`）：实例数据库工具屏蔽 `console_*` 表、SSH 终端默认要求主机指纹、`http.trustProxy` 与反向 WS 本机规则、适配器 README 同步权限级别。

- 只绑定适配器 / 账号作用域的用户在导航里看不到插件页面，即使其作用域已满足页面权限（页面目录可见性需要按作用域判断）。
- 引导安装仍有两条路径：`OnboardingService.installPackages`（CLI `zhin setup`，直接跑插件管理事务）与网关的 `gateway.packages.install`（Console，停启实例）。`zhin install` / `uninstall` / `update` 在网关运行时已走本地套接字（B1.6），`zhin setup` 的安装步骤还没有。
- `--standalone`（开发 / 测试，无网关）的实例仍在本进程装配 IAM 与终端（`installConsoleIam` / `installHostConsoleTerminal`），因为没有网关替它认证；受管实例（有控制通道）不装配、不定义 `console_*` 表。`zhin.js/instance` → `@zhin.js/gateway/iam|terminal` 的依赖边随 `--standalone` 一起删除。
- 网关运行时 `zhin console init` 直接写项目数据库（网关按初始化标记立即关闭开放 Host）；如果它改了 `database` 配置，仍提示手动重启——应改走本地控制套接字，由网关换库并重启实例。
- Windows 命名管道（本地控制套接字）未在 Windows 上实测。
- 网络数据库驱动（MySQL / PostgreSQL）下网关与实例共用项目数据库未实测；只验证了 SQLite（WAL，两连接）。

## 待所有者决定

（暂无）
