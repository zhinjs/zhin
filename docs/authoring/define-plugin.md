# definePlugin 能力全景

`definePlugin` 是插件的声明入口，来自 `@zhin.js/plugin-runtime`。一个插件就是一份 `PluginDefinition`：名字、元数据、依赖声明，外加一个 `setup(context)` 装配函数。

```ts
import { definePlugin } from '@zhin.js/plugin-runtime';

export default definePlugin<MyConfig>({
  name: 'my-plugin',
  metadata: { displayName: 'My Plugin', icon: 'Blocks', order: 10 },
  requires: [databaseHostToken],
  async setup(context) {
    // 装配：注册命令之外的运行时资源（表、cron、Agent 工具、出站推送……）
    return () => { /* generation 结束时执行 */ };
  },
});
```

- `name` 必填，必须匹配 `^[a-z][a-z0-9-]*$`，否则 `definePlugin` 直接抛 `TypeError`。
- 返回的 definition 被 `Object.freeze`，不可再改。
- `setup` 可同步、可 async；返回值（可选）是一个 `Dispose`，在当前代（generation）结束时执行。

> 从零起步的完整教程见 [编写第一个插件](../getting-started/first-plugin.md)；插件模型概念见 [插件模型](../concepts/plugin-model.md)。

## setup context 五件

`setup` 收到的 `PluginSetupContext<TConfig>` 只有五个成员，全部只读：

| 成员 | 类型 | 作用 |
| --- | --- | --- |
| `plugin` | `PluginInstanceView` | 实例视图：`id` / `instanceKey` / `parent` / `root` / `role`（`'root' \| 'child'`）。多实例部署时按 `instanceKey` 隔离 |
| `config` | `ConfigView<TConfig>` | 配置视图，`config.get()` 返回只读配置。默认值来自插件包 `schema.json`，由 `zhin.config.yml` 的 `plugin:` 段（Root 自身）或 `plugins.<key>` 段覆盖 |
| `resources` | `Scope` | 资源作用域：`has(token)` / `use(token)` 解析 Host token，`provide(token, value, dispose?)` 向子作用域发布资源 |
| `lifecycle` | `DisposeStack` | 代的回收栈：`lifecycle.add(dispose)` 登记的清理函数在代结束时按逆序执行 |
| `handoff` | `GenerationHandoffRegistry` | 代际交接注册表：`handoff.add(participant)` 参与热重载事务（见下文「代际交接」） |

```ts
// examples/capabilities-bot/plugin.ts（节选）
async setup(context) {
  const { instanceKey } = context.plugin;            // ① 实例视图
  const config = context.config.get();               // ② 配置视图
  if (context.resources.has(databaseHostToken)) {    // ③ 资源作用域
    const db = context.resources.use(databaseHostToken);
    db.define('showcase_counter', { /* … */ });
  }
  context.lifecycle.add(schedule.register({ /* … */ })); // ④ 生命周期回收
  return () => console.log('disposed');              // ⑤ setup 返回 Dispose
}
```

### Scope 解析规则

`resources` 是一条父子链：`use(token)` 先查本作用域，未命中则向父作用域递归；整条链都没有则抛 `Missing resource` 错误。可选能力一律先 `has(token)` 再 `use(token)`，缺失时自行降级。

## metadata 与 requires

`metadata` 三个字段服务于 Remote Console 的插件卡片（`/api/plugins`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `displayName` | `string` | 展示名 |
| `icon` | `string` | 图标名 |
| `order` | `number` | 排序权重 |

`requires` 声明硬依赖的 Host token 数组，缺失即拒绝启动——与 `has()` + 降级的软依赖路径互为补充：

```ts
// 硬依赖：没有数据库就不启动
export default definePlugin({
  name: 'my-plugin',
  requires: [databaseHostToken],
  // …
});
```

## Host token 全表

Host token 是 Host 提供给插件的能力句柄。`setup` 里通过 `context.resources` 解析；CLI Host 启动时自动装配，未装配的 token 用 `has()` 判空降级。前六个从 `@zhin.js/plugin-runtime` 导出，`httpHostToken` 从 `@zhin.js/host-http` 导出。

| token | token id | 提供条件 | 关键方法 |
| --- | --- | --- | --- |
| `databaseHostToken` | `zhin.database.host` | 配置了 `database:` | `define(name, columns)` 注册表；`models.get(name)` 取模型（`select` / `insert` / `update` / `delete` / `count`）；`start()` 由 Host 在代激活时调用，插件不自己调 |
| `scheduleHostToken` | `zhin.schedule.host` | 始终可用 | `register(job)` 注册 6 段 solar cron（`秒 分 时 日 月 周`），返回取消函数；`list()` 列出任务 |
| `outboundHostToken` | `zhin.outbound.host` | 有可用 Adapter | `send(input)` 主动推送（返回平台消息 id 或 `null`）；可选 `addReaction` / `removeReaction` / `recall` |
| `agentToolsHostToken` | `zhin.agent-tools.host` | 安装并启用 AI（Agent Host） | `register(tool)` 注册 Agent 工具，返回注销函数 |
| `htmlRendererToken` | `zhin.html-renderer.host` | 安装了 `@zhin.js/html-renderer` | `render(html, { width, format, backgroundColor })` → PNG（Buffer）或 SVG（string）；未安装时必须降级为纯文本 |
| `runtimeEventPublisherToken` | `zhin.runtime.event-publisher` | Root 级，CLI console 装配 | `publish(type, data)` 向 Console SSE hub 广播事件（适配器用来推 `endpoint:request` / `endpoint:notice` 等） |
| `httpHostToken` | `zhin.host.http` | HTTP Host 启用 | `route(method, path, handler, meta?)` 注册 HTTP 路由；`ws(path).onConnection(cb)` 注册 WS 端点；`listen()` / `close()` 由 Host 管理 |

典型用法（软依赖 + 生命周期回收）：

```ts
// ④ 定时任务：dispose 挂 lifecycle，热重载安全回收
if (config.heartbeatCron && context.resources.has(scheduleHostToken)) {
  const schedule = context.resources.use(scheduleHostToken);
  context.lifecycle.add(schedule.register({
    id: 'capabilities-bot/heartbeat',
    cron: config.heartbeatCron,
    description: 'Showcase heartbeat',
    execute: () => log('heartbeat ♥'),
  }));
}

// ⑤ Agent 工具：装了 Agent Host 才存在，未装静默跳过
if (context.resources.has(agentToolsHostToken)) {
  const agentTools = context.resources.use(agentToolsHostToken);
  context.lifecycle.add(agentTools.register({
    name: 'showcase_greet',
    description: 'Return the configured greeting for a name',
    source: 'capabilities-bot',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    execute: (input) => `${config.greeting}，${String(input.name ?? 'world')}！`,
  }));
}
```

`AgentToolRegistration` 的常用字段：`name`（模型可见的工具名）、`description`、`inputSchema`（zod 或 JSON Schema）、`platforms` / `scopes` / `permissions`（按消息维度限制可见性）、`hidden`（只按名调用、不进入工具目录）、`approval`（`'never' | 'always'`，与执行策略叠加）、`source`（来源标注）。

## 代际交接（handoff）

热重载是一次「代」事务：新一代装配完成后，旧代静默、新代激活、失败则回滚。`context.handoff.add(participant)` 注册参与者，可实现的钩子：

| 钩子 | 时机 |
| --- | --- |
| `quiescePrevious(previous)` | 旧代静默（如暂停接收新事件） |
| `activateNext()` | 新代激活（如启动 endpoint、启动 cron 后的首个动作） |
| `deactivateNext()` | 激活失败时回滚新代 |
| `resumePrevious()` | 回滚后恢复旧代 |
| `openNext()` | 事务提交后开放准入（如开始收消息） |

capabilities-bot 用它解决启动时序竞争——endpoint 就绪后再推上线消息：

```ts
context.handoff.add({
  activateNext: async () => {
    await outbound.send({ ...target, content: `${config.greeting}，capabilities-bot 已上线` });
  },
});
```

## 真实示例

- **[capabilities-bot](https://github.com/zhinjs/zhin/tree/main/examples/capabilities-bot)**：`plugin.ts` 一个 `setup()` 调动全部常用 Host 面（database / schedule / agent-tools / outbound / handoff），每一项都配 `has()` 降级，是本文所有代码片段的来源。
- **[lottery](https://github.com/zhinjs/zhin/tree/main/plugins/utils/lottery)**（`plugins/utils/lottery/plugin.ts`）：生产级插件——数据库优先用 `databaseHostToken`、缺省落内存实现；`provide` 自有 token 给命令复用；Agent 工具走 `await import()` 惰性加载，保证 IM-only 安装不引入 `@zhin.js/agent`；cron 每日流水线。

lottery 的装配骨架值得抄：

```ts
// plugins/utils/lottery/plugin.ts（节选）
async setup(context) {
  const config = resolveLotteryConfig(context.config.get());
  const db = context.resources.has(databaseHostToken)
    ? context.resources.use(databaseHostToken)
    : createInMemoryLotteryDb();
  if (context.resources.has(databaseHostToken)) {
    defineLotteryTables(db);
  }
  context.resources.provide(lotteryRuntimeToken, { db });

  // Agent 工具惰性加载：IM-only 安装不含 @zhin.js/agent
  if (context.resources.has(agentToolsHostToken)) {
    const agentTools = context.resources.use(agentToolsHostToken);
    const { registerLotteryAgentTools } = await import('./agent/runtime-tools.js');
    context.lifecycle.add(registerLotteryAgentTools(agentTools));
  }
  // …cron 注册见 scheduleHostToken 一节
}
```

## 下一步

- [约定目录](./conventions.md)：commands / middlewares / adapters 等目录如何被发现
- [模块级状态](./module-state.md)：`provide` / 模块单例之外的正确姿势
