# Host Token 总览（运行时 API）

Plugin Runtime 里，插件通过 `context.resources.use(token)`（setup 期）或命令/工具的 `use(token)`（执行期）按 token 取用 Host 能力。本页索引常用 token；各 token 的方法面以对应包的类型定义为准。

## 消息与投递

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `outboundMessageToken`（`zhin.js/core/runtime` 或 `@zhin.js/core/runtime`） | `OutboundMessageService` | `send(request) → DeliveryReceipt` / `registerInteractiveHandler`；入站处理与端点内部发送不属于此公共契约 |
| `outboundHostToken`（`zhin.js`） | `OutboundHost` | `send({ adapter, endpointKey, conversation, content })` —— 主动出站；`sendTarget(target, content)` 按完整持久目标精确发送 |
| `outboundRootHostToken`（`zhin.js`，仅 root） | `OutboundRootHost` | 进程级投递端口；Runtime 为每个插件绑定 `PluginOutboundHost` |
| `runtimeEventPublisherToken`（`zhin.js`） | `RuntimeEventPublisher` | 广播 runtime 事件（inbox/Console 消息流的来源） |

## 持久化

| Token | 注入后得到 | 关键方法 |
| --- | --- | --- |
| `databaseHostToken`（`zhin.js`） | `PluginDatabaseHost`（包括 root 在内均按 owner 隔离表名） | `define(name, def)` / `models.get(name)`；`state` 保存 JSON 小对象，支持 TTL 与原子更新；`select()` 须显式列名（不支持 `'*'`） |
| `databaseRootHostToken`（`zhin.js`，仅 root） | `DatabaseHost` | 进程级宿主：Console 管理面、自定义 composition root 用 |

### 完整投递目标与小对象状态

`createDeliveryTarget(message)` 复制公开的 `message.conversation`：准确的 Endpoint ID、Adapter owner、会话类型与 ID、父频道和线程。结果可直接 JSON 序列化或保存到 `database.state`；它不持有 Message、客户端或旧 generation。不要自己把 ID 替换成名称或显示平台名。

```ts
import {
  createDeliveryTarget, databaseHostToken, outboundHostToken,
  type DeliveryTarget, type Message, type UseAccessor,
} from 'zhin.js';

async function remember(message: Message, use: UseAccessor) {
  const target = createDeliveryTarget(message);
  const state = use(databaseHostToken).state.forConversation(target);
  await state.set('target', target);
  await state.update<number>('count', (current) => (current ?? 0) + 1);
  await state.set('recent', { text: '提醒我' }, { ttlMs: 60_000 });
}

async function deliver(stateTarget: DeliveryTarget, use: UseAccessor) {
  const outbound = use(outboundHostToken);
  if (!outbound.sendTarget) throw new Error('当前 Host 未提供完整目标投递');
  await outbound.sendTarget(stateTarget, '提醒到了');
}
```

投递通过当前 operation 的 Runtime 与统一渲染／出站中间件链路。发送者的插件 owner 由 `PluginOutboundHost` 注入，目标的 Adapter owner 只负责寻址；发送者的组件和资源不会被错误地切换为适配器插件。目标端点删除或 owner 不匹配时明确拒绝，不改投同名 Bot；投递异常保留 `EndpointDeliveryError.disposition` 的 `rejected`、`not_sent`、`unknown`，不能对 `unknown` 盲目重试。

`use(databaseHostToken).state` 默认按插件实例 owner 隔离。`forUser(endpoint, senderId)` 再按准确端点和用户隔离；`forConversation(target)` 再按完整会话地址（包括父频道与线程）隔离。`get<T>(key)` 返回独立 JSON 副本或 `undefined`；`set` 覆盖、`delete` 删除；`update` 使用数据库 revision 的 compare-and-swap，跨连接竞争会重新读值并重试。因此 updater 必须是同步纯函数，不能在里面发送消息、调用网络或产生其他副作用。单次更新最多重试 64 次，持续竞争时明确报错。

TTL 单位为毫秒，按写入尝试时刻计算；到期后 `get` 与 `update` 视为不存在。省略 `ttlMs` 表示持久保存，更新会替换原 TTL。单值须小于 64 KiB UTF-8 JSON；函数、Date、NaN、稀疏数组、getter、隐藏属性、循环引用均被拒绝。该接口面向小对象，不替代需要查询、索引或批量事务的业务表。

CLI 的原子状态支持 SQLite、MySQL、PostgreSQL，使用既有 DatabaseHost 和同一个数据库连接服务。缺少持久服务、数据库未连接或选择 MongoDB／Redis 时明确报错，不回退为内存持久化；其他方言既有的 `models` 接口不受影响。不要跨热重载保存 Store：已开始的状态操作持有 lease 并完成，退休 generation 的 Store 新操作会拒绝，应在当前执行上下文重新 `use(databaseHostToken)`。

验收位于 `basic/cli/tests/plugin-runtime/persistent-state-runtime.test.ts`：真实 Runtime 发现 reminder（会话状态与持久目标）和 preferences（用户状态）两个插件的命名命令，并验证 owner 隔离、热重载和进程重建后的恢复。`persistent-state.test.ts` 验证两连接并发、多人／端点／父频道／线程隔离和 TTL；`persistent-state.live.test.ts` 在独立 MySQL／PostgreSQL 服务验证 CAS。合成发送夹具不代表真实 IM 平台投递验收。

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
