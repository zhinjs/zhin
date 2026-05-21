# Queue Runtime

队列机器人运行时：`enqueueOutgoing`、`claimOutgoing`、`executeOutbound`；入站 `POST {base}/queue/incoming`。

- 存储：`@zhin.js/storage-port`
- 字段契约：re-export `@zhin.js/core` `QueueEnvelope` / `normalizeQueueOutboundDetail`
- 不经 `MessageDispatcher`；与 IM 栈平行
- ADR：[docs/adr/0009-phase-2-edge-storage-queue.md](../../docs/adr/0009-phase-2-edge-storage-queue.md)
