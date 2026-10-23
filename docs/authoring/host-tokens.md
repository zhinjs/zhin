---
title: "Host Token 总览"
description: "插件可以从框架取用的资源：主动发消息、数据库与小对象状态、定时任务、Agent、HTML 渲染、HTTP 路由，以及取用规则"
---

# Host Token 总览

框架提供的能力（发消息、数据库、定时任务、HTTP 路由……）都以 **token** 的形式交给插件。本页列出常用的 token、它们提供什么，以及取用规则。

## 怎么取用

| 在哪里 | 怎么写 |
| --- | --- |
| `plugin.ts` 的 `setup` | `context.resources.use(token)` |
| 命令、工具、定时任务执行时 | 执行参数里的 `use(token)` |

```ts
// plugin.ts：每天 9 点往指定群发"早安"
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
    lifecycle.add(cancel); // 热重载时取消旧任务
  },
});
```

- `target` 写在该插件的配置里。`adapter` 是已挂载适配器的实例路径，`endpointKey` 是该适配器中配置的账号名，不能用内部的 Capability ID 代替。配置层级见 [插件模型](../concepts/plugin-model.md)。
- **必需**的 token 写进 `requires`，缺失时拒绝启动；**可选**的先用 `resources.has(token)` 判断。直接 `use()` 一个不存在的 token 会抛错（例如没装 `@zhin.js/agent` 时取 `agentHostToken`）。
- 数据库、定时任务等 token 会**按插件实例自动隔离**。标注"仅 root"的进程级 token 只在 composition root（`basic/cli`）或显式的 root 场景使用。

## 常用 token

### 发消息

| Token | 得到 | 主要方法 |
| --- | --- | --- |
| `outboundHostToken`（`zhin.js`） | `OutboundHost` | `send({ adapter, endpointKey, conversation, content })` 主动发送；`sendTarget(target, content)` 按保存下来的完整目标精确发送 |
| `outboundMessageToken`（`zhin.js/core/runtime`） | `OutboundMessageService` | `send(request) → DeliveryReceipt`、`registerInteractiveHandler`；入站处理与端点内部发送不属于这个公开接口 |
| `outboundRootHostToken`（`zhin.js`，仅 root） | `OutboundRootHost` | 进程级投递端口；运行时为每个插件绑定 `PluginOutboundHost` |
| `runtimeEventPublisherToken`（`zhin.js`） | `RuntimeEventPublisher` | 广播运行时事件（收件箱与 Console 消息流的来源） |

### 存数据

| Token | 得到 | 主要方法 |
| --- | --- | --- |
| `databaseHostToken`（`zhin.js`） | `PluginDatabaseHost`（root 也按插件隔离表名） | `define(name, def)` / `models.get(name)`；`select()` 必须写明列名（不支持 `'*'`）；`state` 保存 JSON 小对象，见 [下文](#保存小对象和发送目标) |
| `databaseRootHostToken`（`zhin.js`，仅 root） | `DatabaseHost` | 进程级数据库宿主，供 Console 管理面和自定义 composition root 使用 |

### 定时任务

| Token | 得到 | 主要方法 |
| --- | --- | --- |
| `scheduleHostToken`（`zhin.js`） | `PluginScheduleHost`（root 也按插件隔离） | `register({ id, cron, execute })` 返回取消函数；`list()`。cron 为六段：秒 分 时 日 月 周 |
| `scheduleRootHostToken`（`zhin.js`，仅 root） | `ScheduleHost` | 进程级定时宿主 |

### Agent

| Token | 得到 | 主要方法 |
| --- | --- | --- |
| `agentHostToken`（`@zhin.js/agent/runtime`） | Agent Host 端口 | 列出 Agent 绑定、提交 `TurnRequest`、读取 Console / 诊断信息；不暴露 ZhinAgent / AIService 实例 |
| `workroomHostToken`（`@zhin.js/workroom`） | Workroom Host 端口 | 由 CLI 组合根与 `agentHostToken` 一同发布；其 `console` 只含 Workroom 控制端口（run 控制、catalog、profiles / knowledge / sponsor / 数据生命周期）。供 Console / host-http 使用，不供插件注入；Console 视图是两个 console 的 key 不相交合并 |
| `turnIntentResolverToken`（`@zhin.js/agent/runtime`） | 由账号所属插件提供的可信意图解析器 | 按平台 / 场景把消息解析为 `supersede`、`new`、`steer`、`follow_up` 或 `observe`；只有它能为跨参与者的控制签发 `authorizedBy: 'product_policy'` |
| `aiCompletionToken`（`zhin.js`；`zhin.js/agent` / `@zhin.js/agent/runtime` 再导出同一个 token） | `AiCompletion`（可选，只在配置了 AI 时存在，见 [下文](#调用纯文本-ai-补全)） | `completeText({ purpose, system?, prompt, untrusted?, agent?, model?, maxTokens?, timeoutMs?, signal?, onBehalfOf?, usageShares? })` 只做一次纯文本补全，**不带任何工具**，自带重试、超时和同 provider 模型降级；`untrusted` 里的群聊等内容按数据渲染，内部指令无效；传 `onBehalfOf`（类型 `UsageSubject`：`{ userId, groupId?, owner }`，群 / 频道里 `groupId` 为 `${platform}:${endpoint}:${sceneId}`）时计入该用户 / 群的用量配额（超额抛 `AiCompletionQuotaError`）。插件只需要文本时用它，不要借整轮 Agent |

### 渲染与 HTTP

| Token | 得到 | 主要方法 |
| --- | --- | --- |
| `htmlRendererToken`（`zhin.js`） | `HtmlRendererHost` | `render(html, opts)` → PNG；需安装 `@zhin.js/html-renderer`，未安装时出站 HTML 降级为文字 |
| `httpHostToken`（`@zhin.js/host-http`） | `HttpHost` | `route(method, path, handler, meta?)` 注册 HTTP 路由（Console、MCP、A2A、适配器 webhook 共用） |

## 调用纯文本 AI 补全

`aiCompletionToken` 和它的类型都从 `zhin.js` 主入口导入，插件不需要依赖 `@zhin.js/agent`。只有安装并配置了 AI（`@zhin.js/agent`）时运行时才提供这个资源，所以先判断再 `use()`：

```ts
import { defineCommand } from 'zhin.js/command';
import { aiCompletionToken, hasResource, isAiCompletionQuotaError, usageSubjectFromMessage } from 'zhin.js';

export default defineCommand({
  execute: async (context) => {
    if (!hasResource(context, aiCompletionToken)) return '没有配置 AI，无法总结';
    const onBehalfOf = context.input ? usageSubjectFromMessage(context.input) : undefined;
    try {
      const { text } = await context.use(aiCompletionToken).completeText({
        purpose: 'summarize-chat',
        system: '用三句话总结下面的聊天记录。',
        prompt: '请总结。',
        untrusted: [{ source: 'group-chat', text: context.args.join(' ') }],
        onBehalfOf,
      });
      return text;
    } catch (error) {
      if (isAiCompletionQuotaError(error)) return error.message;
      throw error;
    }
  },
});
```

| 导出（`zhin.js`） | 作用 |
| --- | --- |
| `hasResource(context, token)` | `context.use(token)` 能成功时返回 `true`，不抛错。优先用上下文的 `has()`，没有时退回试探 `use()` |
| `context.has?.(token)` | 内置的构造 / 能力上下文（命令、工具、中间件、`@zhin.js/testing` 的假插件）都提供 `has()`；它是可选成员，自己手写的上下文不必实现 |
| `usageSubjectFromMessage(message)` | 按和 Agent 回合相同的规则生成 `onBehalfOf`：平台优先取 `clientAdapter`，账号优先取 `endpointId`，群 / 频道里 `groupId` 为 `${platform}:${endpoint}:${sceneId}`，发送者有 `master` 角色时 `owner` 为 `true`。**消息没有发送者时返回 `undefined`**（不抛错），这时不计入任何人的配额 |
| `isAiCompletionQuotaError(error)` | 判断是否为超额错误（`scope` 为 `user` 或 `group`，`retryAfterSeconds` 为建议等待秒数），`message` 可以直接回复给用户；不需要导入 `@zhin.js/agent` |

::: tip 和 Agent 包的关系
`zhin.js/agent` 和 `@zhin.js/agent` 仍然导出 `aiCompletionToken`，它和 `zhin.js` 导出的是同一个对象，旧代码不用改。`AiCompletionQuotaError` 类仍然在 Agent 包里，插件里用 `isAiCompletionQuotaError` 判断即可。

多人共享一次补全前，先确认服务声明 `supportsUsageShares === true`；旧服务可能忽略未知字段，应继续使用逐人 `onBehalfOf` 调用，不能默默合批而漏记配额。多人共享一次补全时，可用 `usageShares: [{ subject, text }]` 替代 `onBehalfOf`，二者不能同时传入。`text` 是该参与人的原文，服务用现有 token 估算器计算占比，按比例分摊输入预留和最终增量；每群请求计数一次。个人额度不足时，调用在请求 provider 和预留额度前抛出带 `deniedUserIds` 的 `AiCompletionQuotaError`。调用方应移除这些人的待审项，重新构造 prompt 和 usageShares 后再提交；不能只删计费主体却仍审核其消息。群额度不足则停止该群请求。既有单人调用保持兼容；用量不足或 provider 失败的行为与原有预留规则一致。
:::

## 保存小对象和发送目标

很多插件需要"记住在哪个群里、给谁发提醒"。`createDeliveryTarget(message)` 把收到消息的会话地址复制成一个可以序列化的对象，`database.state` 用来保存这类小对象：

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

| 方法 | 作用 |
| --- | --- |
| `state.get<T>(key)` | 读取，返回独立的 JSON 副本或 `undefined` |
| `state.set(key, value, { ttlMs? })` | 覆盖写入；`ttlMs` 是有效期（毫秒），省略表示永久保存 |
| `state.update(key, fn)` | 原子更新：并发冲突时自动重读并重试 |
| `state.delete(key)` | 删除 |
| `state.forUser(endpoint, senderId)` | 按账号 + 用户隔离的子空间 |
| `state.forConversation(target)` | 按完整会话地址（含父频道、线程）隔离的子空间 |

::: warning update 的回调必须是纯函数
`update` 的回调可能被重试多次（最多 64 次，持续冲突时报错），所以里面不能发消息、请求网络或产生其他副作用。
:::

::: details 更多规则
- **目标**：`createDeliveryTarget` 复制的是公开的 `message.conversation`——准确的账号 ID、适配器、会话类型与 ID、父频道和线程。它不持有 Message、客户端或旧版本的引用。不要自己把 ID 换成名字或平台显示名。
- **投递**：经过当前执行的运行时与统一的渲染 / 出站中间件链路。发送方插件身份由 `PluginOutboundHost` 注入，目标里的适配器只用于寻址，发送方的组件和资源不会被切换成适配器插件的。目标账号被删除或身份不匹配时明确拒绝，不会改投到同名 Bot。投递异常保留 `EndpointDeliveryError.disposition`（`rejected`、`not_sent`、`unknown`），**不要对 `unknown` 盲目重试**。
- **隔离**：`state` 默认按插件实例隔离，`forUser` / `forConversation` 再细分。
- **大小与类型**：单个值必须小于 64 KiB（UTF-8 JSON）；函数、Date、NaN、稀疏数组、getter、隐藏属性、循环引用都会被拒绝。它面向小对象，不能替代需要查询、索引或批量事务的业务表。
- **TTL**：按写入尝试的时刻计算；过期后 `get` 和 `update` 视为不存在；更新会替换原来的 TTL。
- **数据库支持**：原子状态支持 SQLite、MySQL、PostgreSQL，复用同一个数据库连接。缺少持久服务、数据库未连接，或使用 MongoDB / Redis 时会明确报错，不会退回内存存储；其他方言原有的 `models` 接口不受影响。
- **热重载**：不要跨热重载保存 Store 对象。已开始的操作会正常完成；旧版本 Store 上的新操作会被拒绝，应在当前执行上下文里重新 `use(databaseHostToken)`。
- **测试**：`basic/cli/tests/plugin-runtime/persistent-state-runtime.test.ts` 用真实运行时验证了 reminder（会话状态与持久目标）和 preferences（用户状态）两个插件的隔离、热重载和进程重建后的恢复；`persistent-state.test.ts` 验证并发、多人 / 账号 / 父频道 / 线程隔离与 TTL；`persistent-state.live.test.ts` 在独立的 MySQL / PostgreSQL 上验证原子更新。合成的发送夹具不代表真实平台的投递验收。
:::

## 内部 token

AI 兜底回复不是插件可以修改的 API。composition root 在启动时向 root 资源提供内部的 `ingressRouteToken`，`ImRuntime.receive` 只从当前消息持有的快照中读取它。普通插件不应注册或替换这个 token。

## 下一步

- [definePlugin](./define-plugin.md)：在 `setup` 里使用这些资源的完整示例。
- [模块级状态](./module-state.md)：把自己的服务也做成 token。
