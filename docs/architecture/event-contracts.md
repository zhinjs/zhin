# 队列事件 — 推荐形状（契约）

供 **队列消费者 / 生产者**、适配器桥接与文档对齐使用。IM 入站仍以 `Message` + `Adapter.emit('message.receive')` 为准。

## 顶层

```ts
interface QueueEnvelope {
  /** 业务命名空间，如 incoming / outgoing / system */
  kind: string;
  /** 细分类，如 text / media / command / tick */
  type: string;
  /** 载荷：建议扁平化可序列化 JSON，键名遵循 queue-im-field-contract */
  detail: Record<string, unknown>;
  /** ISO8601 或 ms 时间戳（团队统一一种） */
  ts?: string | number;
}
```

## `detail` 与 IM 对齐（最小集）

当事件表示「一条可对用户可见的消息」时，`detail` **建议**包含：

| 键 | 类型 | 说明 |
|----|------|------|
| `context` | `string` | 对齐 `SendOptions.context` |
| `bot` | `string` | 对齐 `SendOptions.bot` |
| `channelId` | `string` | 对齐 `SendOptions.id` |
| `channelType` | `'group' \| 'private' \| 'channel'` | 对齐 `SendOptions.type` |
| `senderId` | `string` | 可选；对齐 `Message.$sender.id` |
| `content` | `string` 或 segment 数组 | 对齐 `SendOptions.content` |

出站队列 job 若由同一机器人回发到 IM，应在边界适配器将上表 **映射** 为 `Adapter.sendMessage` 的 `SendOptions`，而不是在业务里直调 `bot.$sendMessage`。

## 扩展

- 内部系统事件可使用 `kind: 'system'`、`type` 自定，但 **避免** 与上表语义字段同名不同义。

详见 [queue-im-field-contract.md](./queue-im-field-contract.md)。
