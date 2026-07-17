# @zhin.js/next-im

下一代 Zhin 的轻量 IM Runtime。它从一个 immutable `RuntimeSnapshot` 完成入站 middleware、Command dispatch、Component render、出站 middleware 和 Adapter Endpoint send，不维护第二套可写 registry。

## 深模块接口

`ImRuntime` 对 Host 和 Adapter 只暴露三个动作：

- `attach(snapshotStore)`：绑定一棵 Root 的 generation authority，只允许绑定一次。
- `receive(message)`：平台入站，整条调用持有一个 snapshot lease。
- `send(request)`：主动出站，获取一个 snapshot lease 后走统一发送链路。

`install(scope)` 将同一个 Runtime 作为 `messageGatewayToken` 提供给 Root Plugin tree。Adapter 只依赖该 Token，不持有 RootRuntime 或可写 registry。

## Host 组合

```ts
import { ImRuntime } from '@zhin.js/next-im';
import { RootRuntime } from '@zhin.js/next-runtime';

const im = new ImRuntime({ commandPrefix: '/' });
const root = new RootRuntime({
  projectRoot: process.cwd(),
  modules,
  environment,
  installResources({ resources }) {
    im.install(resources);
  },
});

im.attach(root.controller.snapshots);
await root.start();
```

`attach()` 必须在 `root.start()` 前完成，因为 Adapter projection 的 `create()` 可能读取 `messageGatewayToken`。

## 入站链路

```text
Endpoint callback
  -> MessageGateway.receive
  -> acquire SnapshotLease
  -> inbound MiddlewareIndex
  -> MessageDispatcher
  -> CommandIndex longest-prefix dispatch
  -> command result -> Message.$reply
  -> release SnapshotLease
```

Command 只在配置前缀开头匹配。`/gh issue list open` 会优先匹配 `gh issue list`，并把 `open` 作为 `context.args[0]`；原始 `Message` 位于 `context.input`。Command 返回非 `undefined` 的 `SendContent` 时自动回复，也可以在 execute 内显式调用 `Message.$reply()`。

`$reply` 只在当前入站作用域有效。这样旧 generation 的 Message 不会在 lease 释放后继续使用已经 dispose 的 Component 或 Endpoint。

## 统一出站链路

```text
Message.$reply / ImRuntime.send
  -> OutboundRenderer
  -> ComponentIndex owner fallback
  -> outbound MiddlewareIndex
  -> AdapterIndex.send
  -> Endpoint.send
```

`component(name, props)` 创建惰性 Component 调用；Renderer 在 requester Plugin 的 ancestor 链解析 definition。`raw(payload)` 显式表示平台 payload。数组会递归渲染，Component 递归深度上限为 32。

Outbound middleware 获得 `OutboundEnvelope`。调用 `envelope.replace(payload)` 可以结构化替换渲染结果；不调用 `next()` 可以短路发送。所有主动发送和回复都经过同一条 hook 链，平台 Adapter 不应在 Command 或 Component 中被直接调用。

## Generation 一致性

一次 `receive()` 从 middleware 进入到 Endpoint send 始终使用同一 snapshot。处理中即使 Root 提交了新 generation，当前消息仍使用旧 Command、Component、配置和 Adapter；旧 projection 要等最后一个 lease 释放后才 dispose。

主动 `send()` 每次读取调用开始时的当前 generation。Middleware 和 Endpoint 不得缓存 projection 到调用之外。

## 依赖预算

本包只有五个 workspace runtime dependency：Kernel 和 Adapter/Command/Component/Middleware Feature，不引入 React、Vite、编译器、watcher、平台 SDK 或 matcher 库。

## 验证

```bash
pnpm --filter @zhin.js/next-im test
pnpm --filter @zhin.js/next-im build
pnpm --filter @zhin.js/next-im check:size
```
