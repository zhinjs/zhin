# Host Token 总览（运行时 API）

Plugin Runtime 里，插件通过 `context.resources.use(token)`（setup 期）或命令/工具的 `use(token)`（执行期）按 token 取用 Host 能力。本页索引常用 token；各 token 的方法面以对应包的类型定义为准。

## 消息与投递

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `outboundMessageToken`（`zhin.js/core/runtime` 或 `@zhin.js/core/runtime`） | `OutboundMessageService` | `send(request) → DeliveryReceipt` / `registerInteractiveHandler`；入站处理与端点内部发送不属于此公共契约 |
| `outboundHostToken`（`zhin.js`） | `OutboundHost` | `send({ adapter, endpointKey, conversation, content })` —— 主动出站；`conversation` 为 `{ kind, id, parent?, threadId? }` |
| `runtimeEventPublisherToken`（`zhin.js`） | `RuntimeEventPublisher` | 广播 runtime 事件（inbox/Console 消息流的来源） |

## 持久化

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `databaseHostToken`（`zhin.js`） | `PluginDatabaseHost`（包括 root 在内均按 owner 隔离表名） | `define(name, def)` / `models.get(name)` → `select / insert / update / delete / count`；`select()` 须显式列名（不支持 `'*'`） |
| `databaseRootHostToken`（`zhin.js`，仅 root） | `DatabaseHost` | 进程级宿主：Console 管理面、自定义 composition root 用 |

## 定时与日程

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `scheduleHostToken`（`zhin.js`） | `PluginScheduleHost`（包括 root 在内均按 owner 隔离） | `register({ id, cron, execute })` 返回取消函数 / `list()`；cron 为六段（秒、分、时、日、月、周） |
| `scheduleRootHostToken`（`zhin.js`，仅 root） | `ScheduleHost` | 进程级日程宿主 |

## Agent

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `agentHostToken`（`@zhin.js/agent/runtime`） | Agent Host 端口 | 列举 Agent binding、提交 canonical `TurnRequest`，以及读取 Console/诊断投影；不暴露 ZhinAgent / AIService 实例 |
| `turnIntentResolverToken`（`@zhin.js/agent/runtime`） | Endpoint owner 提供的可信 intent resolver | 按 adapter / scene 将消息解析为 `supersede`、`new`、`steer`、`follow_up` 或 `observe`；只有该 resolver 能为跨参与者控制签发 `authorizedBy: 'product_policy'` |

## 渲染与 HTTP

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `htmlRendererToken`（`zhin.js`） | `HtmlRendererHost` | `render(html, opts)` → png（装了 `@zhin.js/html-renderer` 时可用；未装时出站 html 段降级文本） |
| `httpHostToken`（`@zhin.js/host-http`） | `HttpHost` | `route(method, path, handler, meta?)` 注册 HTTP 路由（Console/MCP/A2A/适配器 webhook 共用） |

## 用法示例

```ts
import { definePlugin, outboundHostToken, scheduleHostToken } from 'zhin.js';

interface ReminderConfig {
  target: {
    adapter: string;
    endpointKey: string;
    conversation: { kind: 'private' | 'group' | 'channel'; id: string };
  };
}

export default definePlugin<ReminderConfig>({
  name: 'reminder',
  requires: [scheduleHostToken, outboundHostToken],
  setup({ resources, config, lifecycle }) {
    const schedule = resources.use(scheduleHostToken);
    const outbound = resources.use(outboundHostToken);
    const target = config.get().target;
    const cancel = schedule.register({
      id: 'morning',
      cron: '0 0 9 * * *',
      async execute() {
        await outbound.send({ ...target, content: '早安' });
      },
    });
    lifecycle.add(cancel);
  },
});
```

`target` 放在该插件的配置节点，`adapter` 是已挂载 Adapter 的实例路径，`endpointKey` 是该实例中已配置的 Endpoint 名称，不能用内部 Capability ID 替代。配置层级见[插件模型](../concepts/plugin-model.md)。取消函数加入 `lifecycle`，避免热重载后保留旧任务。

规则：setup 中使用 `resources.use()`，命令/工具执行中使用其上下文的 `use()`；token 未安装对应 Host 时会抛错（如未装 `@zhin.js/agent` 取 `agentHostToken`）。必需的 Host 用 `requires` 声明，可选 Host 先用 `resources.has(token)` 检查。Scope 化 token（database/schedule）按插件 owner 自动隔离，root 进程级 token 仅在 composition root（`basic/cli`）或显式 root 场景使用。

AI fallback 不是 `OutboundMessageService` 的可变插件 API。composition root 在 generation setup
中向 root resources 提供内部 `ingressRouteToken`；`ImRuntime.receive` 只从当前消息所持
snapshot 解析该 route。普通插件不应注册或替换此 token。
