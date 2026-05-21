# StoragePort

轻量命名空间 KV，供 Queue Runtime 与 Edge 部署绑定 Deno KV / D1（二期 D1 通过 `KvLike` 适配或后续驱动）。

- 接口：`get` / `set` / `delete` / `list`
- 默认驱动：`memory`
- ADR：[docs/adr/0009-phase-2-edge-storage-queue.md](../../docs/adr/0009-phase-2-edge-storage-queue.md)
