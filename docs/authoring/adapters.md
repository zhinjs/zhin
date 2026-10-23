---
title: "适配器开发"
description: "为 Zhin 还不支持的平台编写适配器：最小实现、连接与清理、收发消息、多账号，以及什么时候需要更底层的 Endpoint"
---

# 适配器开发

适配器把一个聊天平台接入 Zhin。**只有当你要接入的平台还没有官方适配器时，才需要读这一页**；已支持的平台见 [平台适配器](../adapters/index.md)。

适配器只做三件事：

1. 创建平台 SDK 的客户端（Client）；
2. 把平台事件转换成 Zhin 的统一消息；
3. 把 Zhin 要发出的消息转换成平台 API 调用。

热重载、账号身份、版本切换和资源清理都由框架负责。

## 最小实现

在插件里创建 `adapters/<平台名>/index.ts`，默认导出 `defineAdapter()`：

```ts
// adapters/example/index.ts
import { defineAdapter } from 'zhin.js/adapter';
import { ExampleClient } from 'example-sdk';

export default defineAdapter<{ readonly token: string }>({
  capabilities: ['inbound', 'outbound'],

  create(context) {
    const client = new ExampleClient(context.config.token);

    return {
      client,

      async connect({ events, signal, onCleanup }) {
        await client.login({ signal });
        onCleanup(() => client.logout());
        const unsubscribe = client.onMessage((message) => {
          void events.message({
            conversation: {
              kind: message.groupId ? 'group' : 'private',
              id: message.groupId ?? message.userId,
            },
            content: message.text,
            sender: { id: message.userId, name: message.nickname },
          });
        });
        onCleanup(unsubscribe);
      },

      send({ conversation, payload }) {
        return client.sendMessage(conversation.id, payload);
      },
    };
  },
});
```

逐段说明：

| 部分 | 作用 |
| --- | --- |
| `capabilities` | 声明支持收（`inbound`）、发（`outbound`）或两者，至少一个 |
| `create(context)` | 每个账号调用一次；`context.config` 是这个账号的配置 |
| `client` | 平台 SDK 实例。命令里通过 `context.$client` 取得，事件处理里通过 `event.client` 取得 |
| `connect()` | 连接平台，**等平台可用后再返回** |
| `onCleanup(fn)` | 每拿到一个资源就立即登记清理。之后的初始化失败时，框架会按逆序回滚 |
| `events.message()` | 上报一条收到的消息，框架会自动补上账号身份 |
| `send()` | 发送消息，返回平台消息 id |

只有一个清理动作时，也可以直接把它作为 `connect()` 的返回值。

## 常见需求

### 让 Bot 能收到这个平台的消息

把适配器所在的插件挂载到 Bot 上，并在 `zhin.config.yml` 里填写配置：

```yaml
configVersion: 2
plugins:
  example: '@example/adapter'
example:
  token: ${EXAMPLE_TOKEN}
```

启动后在 Console 的"渠道与会话"里确认账号在线、消息能收到。完整的挂载方式见 [第一个插件 · 挂载到你的 Bot](../getting-started/first-plugin.md)。

### 一个适配器挂多个账号

不需要改代码。在配置里写 `endpoints` 数组，每一项会创建一个独立的账号连接，`create(context)` 拿到的就是合并后的单账号配置。规则见 [端点生命周期 · 一个适配器挂多个账号](./endpoint-lifecycle.md#一个适配器挂多个账号)。

### 只允许当前版本持有的监听器

某些监听器或输入流在热重载切换时只能由一个版本持有。这种情况实现同步的 `activate({ events })` 并返回释放函数，框架会在切换和回滚时调用它。普通的 SDK 监听器直接写在 `connect()` 里即可。

### WebSocket / SSE 长连接、心跳与重连

不要自己写重连状态机，使用 [`createEndpointLifecycle`](./endpoint-lifecycle.md)。

### 平台特有的消息格式

`share`、音频、卡片等平台特有结构，在 `send()` 这个边界里转换成平台格式。插件发消息仍然统一走 `Message.$reply` 或 `Adapter.sendMessage`，不要另开发送通道。

### 在聊天里管理账号

用 `createEndpointCommands` 为适配器生成 `<适配器> endpoint list / add / remove` 命令，见 [命令 · 适配器的 endpoint 管理命令](./commands.md#适配器的-endpoint-管理命令)。

## 什么时候需要继承 Endpoint

上面的 `defineAdapter` 写法覆盖绝大多数平台。只有当协议需要**自定义的多阶段连接流程**时，才继承 `Endpoint` 类自己实现 `start` / `open` / `close` / `stop`，生命周期钩子说明见 [端点生命周期](./endpoint-lifecycle.md#endpoint-的生命周期钩子)。

## 参考实现

- [`examples/minimal-bot/adapters/terminal/index.ts`](https://github.com/zhinjs/zhin/blob/main/examples/minimal-bot/adapters/terminal/index.ts)：把终端当作一个聊天平台，适合对照学习。
- [`plugins/adapters/napcat`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/napcat)：WebSocket / HTTP 多种连接方式，使用 `createEndpointLifecycle`。

## 下一步

- [端点生命周期](./endpoint-lifecycle.md)：长连接、心跳、重连与多账号。
- [消息流](../concepts/message-flow.md)：消息在框架里的完整路径。
- [插件完整交付](./plugin-delivery.md)：用 adapter harness 测试并发布适配器。

## AI 能力与场景说明

适配器拥有平台能力声明，Agent 不应维护另一份平台操作清单：

- Tool 的 `description`、`inputSchema`、`platforms / scopes / permissions` 描述一个操作。
- `agents/<platform>/skills/<name>/SKILL.md` 按用途和场景组织操作，正文仅在加载后披露。
- `prompt-sections/<name>/index.ts` 承载必要的共同约定，使用 `platforms` 和 `scopes` 限定，不重复罗列 Skill/Tool 清单。
- `segments.supported` 声明出站段，`segments.model[type]` 提供模型扩展字段、平台 `hint` 和可选 `scopes`。场景不匹配时，模型既看不到该段 Schema，也看不到其提示；这不授予发送权限，也不改变手写消息的发送策略。

以下声明表示模型只在群聊获得 share 卡片能力；其他场景仍保留通用文本和已有降级能力。不要根据名称推测平台支持，声明需与实际发送实现一致。

```ts
segments: {
  supported: ['text', 'share'],
  model: {
    share: {
      scopes: ['group'],
      hint: 'Use a real URL and title from the user or tool results.',
    },
  },
}
```

`text` 始终保留为通用回退；若为它声明场景，只限制扩展字段和提示。
