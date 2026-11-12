# Legacy 概念迁移指南

Plugin Runtime 完成收口后，以下 legacy 概念不再出现在对外叙事中。本页集中解释每个旧概念「当时是什么、现在去哪了」，供维护老插件、读旧代码或旧文档时对照。API 级别的废弃清单另见 [Public API Surface](./public-api-surface.md)。

## `usePlugin()` 类插件体系 → 约定式 plugin.ts + definePlugin

- **旧写法**：`@zhin.js/core` 的 `usePlugin()`——类 React Hooks 设计，靠 AsyncLocalStorage 定位调用方文件自动创建插件树。该 API 已从源码与 public surface 删除；`pnpm check:no-removed-plugin-api` 阻止生产代码重新调用。
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
- **新写法**：Host 是 composition root——实例装配根 `zhin.js/instance`（由 `zhin start` 启动的管理网关拉起）统一装配 IM / Agent / Console Host；插件不安装 Host，而是在 `setup` 里通过 Host token 消费 Host 能力（`zhin.js` 导出 `databaseHostToken` 等六个，`@zhin.js/host-http` 导出 `httpHostToken`），未装配的 token 用 `has()` 判空降级。

```ts
// 旧：安装 host 插件获得 HTTP 能力
// 新（plugin.ts setup 内）：
if (context.resources.has(httpHostToken)) {
  context.resources.use(httpHostToken).route('GET', '/hello', handler);
}
```

## 旧 manifest / `plugin.yml` → package.json `zhin` 字段

- **旧写法**：插件根的 `plugin.yml` 清单。该格式及 `PluginManifest` 类型已从源码、构建识别和 public surface 删除。
- **新写法**：`package.json` 的 `zhin` 字段，由 `@zhin.js/runtime`（`packages/im/runtime/src/manifest.ts`）解析并强校验。逐字段说明见 [definePlugin · package.json zhin 字段](../authoring/define-plugin.md)。

```jsonc
// 旧：plugin.yml 描述插件入口与元数据
// 新（package.json）：
{ "zhin": { "protocol": 1, "type": "plugin", "entry": "./plugin.ts" } }
```

## `extends Adapter` 类适配器 → defineAdapter

- **旧写法**：继承 `@zhin.js/core` 的 `Adapter` 基类实现平台适配器。该类和对应 Core `Endpoint` 运行时已删除。
- **新写法**：约定 `adapters/` 目录下默认导出 `defineAdapter({ capabilities, create })`（`@zhin.js/adapter`），按 `capabilities`（`inbound` / `outbound`）声明 IO 能力；Endpoint 实例配置来自 app 配置 `plugins.<instanceKey>`，结构由插件包 `schema.json` 描述。

```ts
// 旧：class MyAdapter extends Adapter { /* ... */ }
// 新（adapters/my.ts）：
export default defineAdapter<MyConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) { /* 返回继承 Endpoint<Client> 的实例 */ },
});
```

## 旧 Console loginAssist → Plugin Runtime LoginAssist

- **旧写法**：Console 插件提供的 loginAssist 页面/路由——适配器投递扫码、滑块等待办，用户在 Web Console 里消费确认。旧 Console 侧页面已移除。
- **现状（Plugin Runtime）**：`ImRuntime` 提供 `loginAssistToken`；ICQQ 等适配器在 `system.login.*` 上 `waitForInput`。消费者：
  - Console RPC：`login.list` / `login.submit` / `login.cancel`（刷新后 `list` 可重拉未消费待办）
  - SSE：`endpoint.login.pending` / `endpoint.login.expired`
  - 交互式 TTY：stdin 一行确认（对齐 icqq 官方示例）
- 带外路径仍可用：`icqq login <uin>` 守护进程扫码后再启动 zhin；`zhin setup` 配置向导。

## 旧多 Agent 执行 API → Agent Harness {#legacy-multi-agent}

旧编排栈（mutable Repository、`AgentDispatcher`、执行型 workflow helper、`remote_mesh`）以及之后的 Workroom Kernel 都已删除，没有兼容层。多 Agent 协作现在只有一套模型：Agent Harness（[ADR 0048](../adr/0048-agent-harness.md)）。

| 旧表面 | 迁移方式 |
| --- | --- |
| `zhin.js/agent` 的 `runPipeline` / `runParallel` / `route` | 普通一次性模型调用改用 `AIService.runAgent`（需要并行时由调用方显式组合 Promise）；需要多 Agent 协作时，让 Agent 使用 `ask` / `delegate` 等协作工具。 |
| `spawn_task(run_id, task_id, ...)` | `spawn_task` 已删除，Agent 之间的协作改用 `ask` / `delegate` 等协作工具（见 [AI Agent · 多 Agent 协作](../ai/agent.md#多-agent-协作)）。 |
| `OrchestrationService` / `OrchestrationKernel` / repositories / `AgentDispatcher` | 无兼容替代对象。协作状态只读自 `engagement_events` Journal（`zhin trace --engagements`、Console 协作图谱）。 |
| `ai.remoteAgents` / `remote_mesh` / Remote Agent poller | 不再支持，启动时遇到 `ai.remoteAgents` 会直接报错。远程 Agent 在 `a2a.mailbox.peers` 声明，Mail 连同 Authority 与预算签名传递。 |
| `ai.workroom` / `ai.workrooms`、`a2a.workroomCallbacks` / `a2a.workroomRemoteExecutors`、`@zhin.js/workroom` | 已删除，启动时遇到这些配置键会直接报错。多 Bot 共享的群或频道改在 `ai.venues` 声明，Agent 能联系谁与预算上限写在 `agents/<name>/agent.json` 的 `collaboration`。 |
| `/api/agent/orchestration/runs`、`/api/agent/workroom/runs` | 改为只读的 `GET /api/agent/engagements[/*]` 与 Console Workroom 页面。 |

旧 Run、Workroom Journal 与 Catalog 不再受支持，也没有迁移工具。如需保留历史信息，请人工整理后作为新消息重新提交。已落地的权威边界见 GitHub 上的 [Agent CONTEXT](https://github.com/zhinjs/zhin/blob/main/packages/im/agent/CONTEXT.md)。

## 相关阅读

- [插件模型](../concepts/plugin-model.md)：Plugin Runtime 的概念总览
- [definePlugin](../authoring/define-plugin.md)：新插件声明与 `package.json` `zhin` 字段
- [仓库结构](./repo-structure.md)：分层架构与依赖方向
