# 适配器开发

平台适配器只做三件事：创建平台 Client、把平台事件转换为 Zhin 事件、把 Zhin 出站请求转换为平台调用。热重载、Endpoint 身份、代际准入和资源清理由框架负责。

在插件或项目的 `adapters/` 目录新建一个 TypeScript 文件并默认导出 `defineAdapter()`：

```ts
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

`client` 是平台 SDK 实例：命令从 `context.$client` 取得它，Handler 从事件参数的 `event.client` 取得它。`connect()` 等到平台可用后返回。每获得一个资源就立即用 `onCleanup()` 登记；如果后续初始化失败，框架会逆序回滚。只有一个清理动作时，也可以直接把它作为 `connect()` 返回值。`events.message()` 会自动补上当前 Endpoint 身份，因此适配器作者不需要解析 capability id。`send()` 返回平台消息 id。

如果某个 listener 或输入流只能由当前激活代持有，可以实现同步的 `activate({ events })`，并返回释放函数。框架在切代和回滚时调用它。普通 SDK listener 直接放在 `connect()` 即可。

只有需要自定义多阶段连接行为的协议才应继承 `Endpoint`。WebSocket、SSE、心跳和重连使用 [`createEndpointLifecycle`](./endpoint-lifecycle.md)，不要重复实现状态机。平台特有的 `share`、音频或卡片结构应在 `send()` 的协议边界转换；统一发送链路仍从 `Message.$reply` 或 `Adapter.sendMessage` 进入。

可运行实现见 [`examples/minimal-bot/adapters/$terminal.ts`](../../examples/minimal-bot/adapters/$terminal.ts)。
