# Legacy 概念迁移指南

zhin.js 4.x 完成 Plugin Runtime 收口后，以下 legacy 概念不再出现在对外叙事中。本页集中解释每个旧概念「当时是什么、现在去哪了」，供维护老插件、读旧代码或旧文档时对照。API 级别的废弃清单另见 [Public API Surface](./public-api-surface.md)。

## `usePlugin()` 类插件体系 → 约定式 plugin.ts + definePlugin

- **旧写法**：`@zhin.js/core` 的 `usePlugin()`——类 React Hooks 设计，靠 AsyncLocalStorage 定位调用方文件自动创建插件树，约束是必须模块顶层调用（门禁 `pnpm check:use-plugin-top-level`）。该函数至今仍存在于 `packages/im/core/src/plugin.ts`，供 legacy app 层（`packages/im/zhin`）兼容使用。
- **新写法**：插件包根目录的约定式 `plugin.ts` 默认导出 `definePlugin(...)`（`zhin.js`），命令、中间件、适配器等放进约定目录（`commands/`、`middlewares/`、`adapters/`…）自动发现，见 [definePlugin](../authoring/define-plugin.md) 与 [约定目录](../authoring/conventions.md)。

```ts
// 旧：const plugin = usePlugin(); plugin.command('ping', ...);
// 新（plugin.ts）：
export default definePlugin({
  name: 'my-plugin',
  setup(context) { /* context.resources / context.lifecycle 装配 */ },
});
```

## `host` 插件叙事 → basic/cli 装配 + Host token

- **旧写法**：`@zhin.js/host` 系列的 router / api 插件包，把 HTTP 路由与 Console API 当作「插件」安装挂载（这些包已删除）。
- **新写法**：Host 是 composition root——`basic/cli` 的 `zhin runtime start` 统一装配 IM / Agent / Console Host；插件不安装 Host，而是在 `setup` 里通过 Host token 消费 Host 能力（`zhin.js` 导出 `databaseHostToken` 等六个，`@zhin.js/host-http` 导出 `httpHostToken`），未装配的 token 用 `has()` 判空降级。

```ts
// 旧：安装 host 插件获得 HTTP 能力
// 新（plugin.ts setup 内）：
if (context.resources.has(httpHostToken)) {
  context.resources.use(httpHostToken).route('GET', '/hello', handler);
}
```

## 旧 manifest / `plugin.yml` → package.json `zhin` 字段

- **旧写法**：插件根的 `plugin.yml` 清单（`PluginManifest`，已标记 deprecated；legacy `Plugin` 与 `zhin build` 仍识别它，见 `basic/cli/src/libs/plugin-package-build.ts`）。
- **新写法**：`package.json` 的 `zhin` 字段，由 `@zhin.js/runtime`（`packages/im/runtime/src/manifest.ts`）解析并强校验。逐字段说明见 [definePlugin · package.json zhin 字段](../authoring/define-plugin.md)。

```jsonc
// 旧：plugin.yml 描述插件入口与元数据
// 新（package.json）：
{ "zhin": { "protocol": 1, "type": "plugin", "entry": "./plugin.ts" } }
```

## `extends Adapter` 类适配器 → defineAdapter

- **旧写法**：继承 `@zhin.js/core` 的 `Adapter` 基类实现平台适配器（该类仍在 `packages/im/core/src/adapter.ts`，供 legacy app 层使用）。
- **新写法**：约定 `adapters/` 目录下默认导出 `defineAdapter({ capabilities, create })`（`@zhin.js/adapter`），按 `capabilities`（`inbound` / `outbound`）声明 IO 能力；Endpoint 实例配置来自 app 配置 `plugins.<instanceKey>`，结构由插件包 `schema.json` 描述。

```ts
// 旧：class MyAdapter extends Adapter { /* ... */ }
// 新（adapters/my.ts）：
export default defineAdapter<MyConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) { /* 返回 EndpointInstance */ },
});
```

## 旧 Console loginAssist → Plugin Runtime LoginAssist

- **旧写法**：Console 插件提供的 loginAssist 页面/路由——适配器投递扫码、滑块等待办，用户在 Web Console 里消费确认。旧 Console 侧页面已移除。
- **现状（Plugin Runtime）**：`ImRuntime` 提供 `loginAssistToken`；ICQQ 等适配器在 `system.login.*` 上 `waitForInput`。消费者：
  - Console RPC：`login.list` / `login.submit` / `login.cancel`（刷新后 `list` 可重拉未消费待办）
  - SSE：`endpoint.login.pending` / `endpoint.login.expired`
  - 交互式 TTY：stdin 一行确认（对齐 icqq 官方示例）
- 带外路径仍可用：`icqq login <uin>` 守护进程扫码后再启动 zhin；`zhin setup` 配置向导。

## 旧多 Agent 执行 API → chat subagent / Workroom

旧编排栈同时存在 mutable Repository、`AgentDispatcher`、执行型 workflow helper 与 `remote_mesh` 状态，无法可靠表达验收、租约恢复、抢占和 Project Memory，因此采用 major breaking replacement，不提供双写兼容层。

| 旧表面 | 迁移方式 |
| --- | --- |
| `zhin.js/agent` 的 `runPipeline` / `runParallel` / `route` | 普通一次性模型调用改用 `AIService.runAgent`（需要并行时由调用方显式组合 Promise）；需要 durable 多 Agent 协作时提交 Workroom Inbox/Plan proposal。未来的 workflow builder 只构造 Plan，不直接执行 Agent。 |
| `spawn_task(run_id, task_id, ...)` | 普通 chat 只保留不带 Workroom identity 的临时 `spawn_task`；Project 工作必须由 Workroom Kernel 创建 Task/Assignment，不能把 subtask id 当 Task id。 |
| `OrchestrationService` / `OrchestrationKernel` / repositories / `AgentDispatcher` | 无兼容替代对象。状态读取转向 Workroom Journal replay/projection；写入必须使用受 principal/role 约束的 Workroom command port。 |
| `ai.remoteAgents` / `remote_mesh` / Remote Agent poller | 不再支持。Remote A2A 已作为标准 `AssignmentExecutorPort` transport 接入，复用 local Assignment 的 lease/fence/report/acceptance，并且只接受持久 Catalog 与 generation-owned authority；不得用旧配置模拟或绕过 Grant。 |
| `/api/agent/orchestration/runs` / `/console/orchestration` | 改为 Project-scoped `/api/agent/workroom/runs?projectId=...` 与 Workroom Console 页面；它们都是只读 projection。 |

旧 Run 不自动恢复或升级成新状态。特别是旧 `completed` 没有 claim-level Acceptance Record，不能当成 `accepted` Project State；历史数据只可离线导出审计，或以带 `legacy_import` provenance 的 untrusted Inbox/Evidence 候选重新规划和验收。已落地的权威边界见 GitHub 上的 [Agent CONTEXT](https://github.com/zhinjs/zhin/blob/main/packages/im/agent/CONTEXT.md)。

离线工具只接受两种真实旧表面：包含 `orchestration_runs`、`orchestration_tasks`、`orchestration_events` 三个数组的旧 Repository 表导出，或旧只读 API 的单个 `{ run, tasks, events }` `RunSnapshot` JSON。字段、状态枚举、JSON 列、引用和 event sequence 任一损坏或未知都会拒绝，不做宽松修复：

```bash
# 只读审计；输出文件采用 create-only，绝不覆盖来源或已有审计
zhin agent legacy-runs ./legacy-orchestration.json --output ./legacy-audit.json

# active 旧 Run 只能产生纯数据 proposal；该命令不会启动 Agent 或写新 Journal
zhin agent legacy-runs ./legacy-orchestration.json \
  --run old-run-id --proposal replan --project target-project \
  --output ./legacy-replan-proposal.json

zhin agent legacy-runs ./legacy-orchestration.json \
  --run old-run-id --proposal cancel \
  --output ./legacy-cancel-proposal.json
```

`open/running/waiting` 报告为 `migration_required`，只允许 `export | cancel_proposal | replan_proposal`；终态只作 `historical_only` 导出。所有报告固定 `accepted: false`，所有 Inbox/Evidence 输出固定为 `trust: untrusted` + `legacy_import` provenance。replan proposal 必须显式指定目标 Project，且仍需由新版 Kernel 的受信 migration admission 重新验收；离线工具自身永远不写 `workroom_events`。

旧 Workroom Journal、Projection、Evidence/Task Report 或 Artifact Header 若曾内嵌正文、subject identifier 或 credential，必须先离线隔离审计，再由人工审批独立执行 export/purge。扫描器只输出字段路径、category、record ref 与 record hash；不会输出原值、片段或原始 JSON，purge plan 固定为 `proposal_only`：

```bash
zhin agent legacy-payloads ./.zhin/workroom-projections \
  --kind projection --storage file --output ./legacy-payload-audit.json

# Database 必须先做显式 versioned read-only row mapping export；工具不连接生产 writer。
zhin agent legacy-payloads ./legacy-workroom-events-export.json \
  --kind journal --storage database --output ./legacy-journal-payload-audit.json
```

active store 必须在打开 production writer 前运行同一 fail-closed gate；发现任意 legacy embedded payload 时固定拒绝启动 writer，不自动导入、重写或删除。

## 相关阅读

- [插件模型](../concepts/plugin-model.md)：Plugin Runtime 的概念总览
- [definePlugin](../authoring/define-plugin.md)：新插件声明与 `package.json` `zhin` 字段
- [仓库结构](./repo-structure.md)：分层架构与依赖方向
