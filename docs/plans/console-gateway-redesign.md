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
5. **网关与实例分离**：`zhin start` 启动管理网关，网关管理 Zhin 实例（起停、依赖、日志），实例崩溃时 Console 仍可用。

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
| A1 RBAC 后端 | doing | 含初始化服务、数据库在线选择、移除 `http.tokens` / 演示模式 |
| A2 三级配置后端 | doing | |
| A3 终端后端 | done | 已提交，待 M2 接线 |
| A4 Console 导航重构 | doing | |
| A5 create-zhin 精简 | doing | |
| M2 集成批 1 | todo | |
| B1 管理网关 | todo | 依赖 M2；B1.0 可在 M2 后立即开始 |
| B2 引导后端 | todo | 依赖 B1.4 |
| M4 集成批 2 | todo | |
| C1–C4 | todo | 依赖发版 |
| M6 文档与迁移 | todo | |
| M7 端到端验收 | todo | |

## 推进方式

- 定时检查（每小时）唤醒本会话：读本节进度与后台任务结果 → 集成已完成的工作并跑检查 → 派发依赖已满足的下一项 → 更新本节并提交。
- 并行工作者只改各自路径，不做 git 写操作；集成、锁文件、Changesets、提交与 PR 由协调者完成。
- 不强推、不跳过测试；PR 进入合并队列后不再推送。
- 需要仓库所有者决定的事项记在下方，不阻塞其他项。

## 待所有者决定

（暂无）
