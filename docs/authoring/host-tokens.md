# Host Token 总览（运行时 API）

Plugin Runtime 里，插件通过 `context.use(token)`（setup 期）或命令/工具的 `use(token)`（运行期）按 token 取用 Host 能力。本页是全量索引；各 token 的方法面以对应包的类型定义为准（链接到源码）。

## 消息与投递

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `messageGatewayToken`（`@zhin.js/core/runtime`） | `MessageGateway` | `receive` / `send(request) → DeliveryReceipt` / `sendEndpointMessage` / `onMessage` / `registerInteractiveHandler` / `setUnmatchedHandler` |
| `outboundHostToken`（`@zhin.js/plugin-runtime`） | `OutboundHost` | `send({ adapter, endpointId, conversation, content })` —— 跨平台出站，寻址用 ConversationRef |
| `runtimeEventPublisherToken`（`@zhin.js/plugin-runtime`） | `RuntimeEventPublisher` | 广播 runtime 事件（inbox/Console 消息流的来源） |

## 持久化

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `databaseHostToken`（`@zhin.js/plugin-runtime`） | `PluginDatabaseHost`（按 owner 隔离表名） | `define(name, def)` / `models.get(name)` → `select / insert / update / delete / count`；`select()` 须显式列名（不支持 `'*'`） |
| `databaseRootHostToken`（`@zhin.js/plugin-runtime`，仅 root） | `DatabaseHost` | 进程级宿主：Console 管理面、自定义 composition root 用 |

## 定时与日程

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `scheduleHostToken`（`@zhin.js/plugin-runtime`） | `PluginScheduleHost`（按 owner 隔离） | 注册/取消 cron 任务；与 `messageGatewayToken` 组合即可做定时推送 |
| `scheduleRootHostToken`（`@zhin.js/plugin-runtime`，仅 root） | `ScheduleHost` | 进程级日程宿主 |

## Agent

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `agentHostToken`（`@zhin.js/agent`，`agent-host-port`） | Agent Host 端口 | 访问 ZhinAgent / AI 服务（装了 `@zhin.js/agent` 时可用） |
| `agentToolsHostToken`（`@zhin.js/plugin-runtime`） | `AgentToolsHost` | `register(tool)`：插件向 Agent 工具目录注册 `agent/tools` |

## 渲染与 HTTP

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `htmlRendererToken`（`@zhin.js/plugin-runtime`） | `HtmlRendererHost` | `render(html, opts)` → png（装了 `@zhin.js/html-renderer` 时可用；未装时出站 html 段降级文本） |
| `httpHostToken`（`@zhin.js/host-http`） | `HttpHost` | `route(method, path, handler, meta?)` 注册 HTTP 路由（Console/MCP/A2A/适配器 webhook 共用） |

## 用法示例

```ts
export default definePlugin({
  name: 'reminder',
  setup({ use }) {
    const schedule = use(scheduleHostToken);
    const gateway = use(messageGatewayToken);
    schedule.register('0 9 * * *', async () => {
      await gateway.send({ conversation, requester, content: '早安' });
    });
  },
});
```

规则：`use()` 在 setup 期调用；token 未安装对应 Host 时 `use()` 抛错（如未装 `@zhin.js/agent` 取 `agentHostToken`）。Scope 化 token（database/schedule）按插件 owner 自动隔离，root 进程级 token 仅在 composition root（`basic/cli`）或显式 root 场景使用。
