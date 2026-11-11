# @zhin.js/gateway

Zhin.js 管理网关（[ADR 0054](../../../docs/adr/0054-management-gateway.md)）。网关负责宿主层面的事：Console 账号与权限、终端、
项目配置与 `.env`、依赖事务、实例监管。它**不依赖 `zhin.js` 与 IM 层**，不加载插件代码（`pnpm check:architecture` 强制）。

网关进程（`zhin start`；`zhin runtime start` 是其前台别名）自己打开项目数据库并持有 `console_*` 表：登录、初始化、`iam.*`、`onboarding.update`、终端与审计
都在网关里，没有实例时 Console 照样可用；受管实例只按转发的主体做授权。`--standalone`（开发 / 测试，无网关）的实例仍在进程内
装配 `installConsoleIam` / `installHostConsoleTerminal`。

## 使用

项目不直接调用本包：`@zhin.js/cli` 的 `zhin start` 启动网关，网关再拉起项目里的 `zhin.js/instance`。新项目由 `create-zhin-app` 生成；已有项目与同批的 `zhin.js`、`@zhin.js/cli` 一起安装（网关与实例之间的控制通道带协议版本，必须一起升级）：

```bash
pnpm add zhin.js@latest @zhin.js/gateway@latest
pnpm add -D @zhin.js/cli@latest
pnpm dev                    # zhin start --foreground --watch source config
zhin start --mode production --no-watch   # 后台；zhin status / logs -f / restart / stop
```

运行时文件：`.zhin/gateway.sock`（本地控制套接字，`0600`）、`.zhin/gateway.json`、`.zhin/logs/instance.log`、`.zhin/logs/gateway.log`。
命令与退出码见 [zhin start](../../../docs/cli/runtime.md)，升级步骤见[升级到管理网关](../../../docs/migrations/management-gateway.md)。

## 子路径

| 子路径 | 内容 |
|---|---|
| `@zhin.js/gateway/iam` | Console 账号、角色、会话、API 令牌、审计与初始化（ADR 0049）：`ConsoleIamService`、`ConsoleSetupService`、`installConsoleIam`、`registerConsoleAuthRoutes`、`dispatchIamRpc` |
| `@zhin.js/gateway/terminal` | Console 终端（ADR 0051）：`TerminalService`、`installHostConsoleTerminal`、`parseTerminalConfig` |
| `@zhin.js/gateway/config` | 原始配置文件与 `.env` 读写：`ConsoleConfigurationStore`、`readEnvFile` / `writeEnvFile`、配置路径与补丁、Console Schema |
| `@zhin.js/gateway/plugin-management` | 项目级依赖事务：`PluginManagementWorkflow`、`PluginManagementActivity`、插件用例 |
| `@zhin.js/gateway/project` | 项目文件工具：`findConfigFile`、`loadRuntimeEnvironmentLayers`、`createTsxModuleLoader`、实例声明迁移、旧配置检测、Node 版本要求 |
| `@zhin.js/gateway/supervisor` | 实例进程监管 `InstanceSupervisor`：IPC 控制通道（`ready` / `shutdown` / `restart-request`）、崩溃重启与风暴保护、日志采集（环形缓冲 + `.zhin/logs/instance.log` 按大小轮转）；`runSupervisedInstance` 供 `zhin start` 使用 |
| `@zhin.js/gateway/usage` | 用量统计聚合 |
| `@zhin.js/gateway/onboarding` | Console 引导（ADR 0053）：`.zhin/onboarding.json` 状态（`OnboardingStateStore`、自动识别已配置步骤）、`OnboardingService`、安装白名单与 `authorizeInstall`、流式 `installPackages` |
| `@zhin.js/gateway/http` | HTML / SSE 响应工具（实例也导入，不加载 Node HTTP 栈） |
| `@zhin.js/gateway/server` | 网关 HTTP 服务器（`GatewayHttpServer`：自有路由、`{base}` 认证后转发、其他路由原样转发、实例离线 503 / 超时 504 / 其他 502；`useConsoleRpc` 登记更多网关 RPC）、`gateway.*` Console RPC 路由、`startGatewayConsole`（项目数据库、本地认证、`/auth/*`、`iam.*`、`onboarding.update`、初始化向导、终端、审计）、`registerGatewayEventRoutes`（合并 `{base}/events`、`{base}/gateway/packages/progress`）、`startGateway`（服务器 + Console + 实例监管 + `@zhin.js/host-http/bridge` 实例传输）、`runGateway`（`zhin start` 的监管 + 网关入口） |
| `@zhin.js/gateway/database` | 网关自己的项目数据库连接（ADR 0054 §7）：`loadProjectDatabaseConfig` / `resolveProjectDatabaseConfig`（与实例 `resolveDatabaseConfig` 同一规则）、`ProjectDatabase`（SQLite WAL + `busy_timeout`） |
| `@zhin.js/gateway` | 以上全部 |

```ts
import { ConsoleIamService } from '@zhin.js/gateway/iam';
import { findConfigFile } from '@zhin.js/gateway/project';
```

只导入需要的子路径：根入口会加载全部区域（数据库驱动定义、终端、包管理器调用等）。

## 依赖边界

依赖 `@zhin.js/host-http`、`@zhin.js/database`、`@zhin.js/console-protocol`、`@zhin.js/runtime`（仅配置与项目文件工具）、
`@zhin.js/plugin-runtime`（契约）与 `@zhin.js/scaffold-wizard`。需要 IM 类型时在本包内定义窄接口，不导入 IM 包。
终端后端 `node-pty` / `ssh2` 是可选依赖，首次使用时才加载。

## 开发

```bash
pnpm --filter @zhin.js/gateway build
pnpm vitest run packages/host/gateway
```
