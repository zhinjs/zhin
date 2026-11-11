# @zhin.js/gateway

Zhin.js 管理网关（[ADR 0054](../../../docs/adr/0054-management-gateway.md)）。网关负责宿主层面的事：Console 账号与权限、终端、
项目配置与 `.env`、依赖事务、实例监管。它**不依赖 `zhin.js` 与 IM 层**，不加载插件代码（`pnpm check:architecture` 强制）。

> 当前阶段（B1.-1）本包是库：网关进程尚未落地，Console 访问控制与终端仍由 Zhin 实例（`zhin.js/instance`）装配进进程内
> HTTP Host；`@zhin.js/cli` 与实例共用这里的项目文件服务。B1.1–B1.4 依次把实例监管、HTTP 服务器、认证与终端移到网关进程。

## 子路径

| 子路径 | 内容 |
|---|---|
| `@zhin.js/gateway/iam` | Console 账号、角色、会话、API 令牌、审计与初始化（ADR 0049）：`ConsoleIamService`、`ConsoleSetupService`、`installConsoleIam`、`registerConsoleAuthRoutes`、`dispatchIamRpc` |
| `@zhin.js/gateway/terminal` | Console 终端（ADR 0051）：`TerminalService`、`installHostConsoleTerminal`、`parseTerminalConfig` |
| `@zhin.js/gateway/config` | 原始配置文件与 `.env` 读写：`ConsoleConfigurationStore`、`readEnvFile` / `writeEnvFile`、配置路径与补丁、Console Schema |
| `@zhin.js/gateway/plugin-management` | 项目级依赖事务：`PluginManagementWorkflow`、`PluginManagementActivity`、插件用例 |
| `@zhin.js/gateway/project` | 项目文件工具：`findConfigFile`、`loadRuntimeEnvironmentLayers`、`createTsxModuleLoader`、实例声明迁移、旧配置检测、Node 版本要求 |
| `@zhin.js/gateway/supervisor` | 实例进程监管 `InstanceSupervisor`：IPC 控制通道（`ready` / `shutdown` / `restart-request`）、崩溃重启与风暴保护、日志采集（环形缓冲 + `.zhin/logs/instance.log` 按大小轮转）；`runSupervisedInstance` 供 `zhin runtime start` 使用 |
| `@zhin.js/gateway/usage` | 用量统计聚合 |
| `@zhin.js/gateway/http` | JSON / HTML / SSE 响应工具 |
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
