# @zhin.js/next-feature-adapter

下一代 Runtime 的 Adapter Feature provider。它从 `adapters/**/*.ts` 发现 Endpoint definition，并把平台连接的 prepare、切代、停流、恢复、发送和销毁纳入同一个 generation transaction。

## 职责

- `defineAdapter()` 建立稳定 definition brand 并声明 `inbound` / `outbound` capability。
- discovery 递归扫描 `adapters/**/*.ts`，目录层级形成稳定 local name。
- `AdapterIndex` 使用 CapabilityId 定位 Endpoint，禁止扫描顺序覆盖。
- projection prepare 只调用 `create()`；不得在此时连接网络或接收入站事件。
- generation handoff 驱动 `start -> open -> close -> stop`。
- `send()` 是平台出站的唯一底层接口，不负责 Component 或 middleware 渲染。

本包不依赖 IM Message、Command、平台 SDK 或网络库。具体 Adapter 可以依赖所选 SDK，并通过 `@zhin.js/next-im` 的 `messageGatewayToken` 接入统一消息链路。

## 目录约定

```text
adapters/
├── discord.ts       # localName: discord
└── qq/
    └── bot.ts       # localName: qq/bot
```

文件必须默认导出 `defineAdapter(...)`。`.tsx`、隐藏目录和不合法路径段不会成为 Adapter Slot。

## 定义 Endpoint

```ts
import { defineAdapter } from '@zhin.js/next-feature-adapter';
import { messageGatewayToken } from '@zhin.js/next-im';

export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const messages = context.use(messageGatewayToken);
    let admitting = false;

    return {
      async start() {
        await sdk.connect();
        sdk.onMessage((event) => {
          if (!admitting) return;
          void messages.receive({
            adapter: context.id,
            target: event.channelId,
            content: event.text,
            id: event.id,
            sender: event.userId,
          });
        });
      },
      open() {
        admitting = true;
      },
      close() {
        admitting = false;
      },
      stop() {
        return sdk.disconnect();
      },
      send({ target, payload }) {
        return sdk.send(target, payload);
      },
    };
  },
});
```

`context.id` 是完整 CapabilityId，`context.name` 是 owner 内 local name；配置和 Resource 始终来自声明该 Adapter 的 Plugin。

## 生命周期事务

```text
prepare candidate: create()
commit before CAS: previous.close() -> candidate.start()
commit after CAS:  candidate.open()
retired lease=0:   previous.stop()
rollback:          candidate.stop() -> previous.open()
```

`start()` 可以异步分配 transport，但不能接收入站事件；`open()` 只切换 admission，因此必须同步。`stop()` 应可重复调用，`AdapterIndex` 仍保证每个实例最多执行一次。某个 Endpoint 失败时，已创建或已启动的 sibling 会逆序清理。

## HMR

Adapter 文件变化产生 Slot generation。候选 Endpoint 完整构造后才关闭旧 admission；失败会恢复旧 Endpoint。旧 generation 仍有消息 lease 时，旧 transport 不会提前 `stop()`。

当前 Feature projector 会在每次 generation 重建所有 projection，因此非 Adapter Slot HMR 也会产生一组候选 Endpoint。它保证正确性和事务一致性；后续可以通过 projection retention 优化连接重建，但不能削弱上述切代语义。

## 验证

```bash
pnpm --filter @zhin.js/next-feature-adapter test
pnpm --filter @zhin.js/next-feature-adapter build
```
