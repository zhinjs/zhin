# minimal-qbot（Queue Beta）

最小 **queue-runtime** 示例：不经过 IM `MessageDispatcher`，仅演示出站双队列 API。

## 配置 spike（Plan 4）

| 方式 | 仓库现状 |
|------|----------|
| `loadQBotConfig()` | **不存在**（全仓库 grep 无实现） |
| `zhin.config.yml` 的 `queue:` 段 | **未接入** `packages/zhin` 启动链 |
| 本示例 | 使用项目根 **`qbot.config.yml`**，由 `src/load-qbot-config.ts` 用 `yaml` 解析 |

后续若统一 loader，可迁到 `@zhin.js/queue-runtime` 或 CLI；Beta 阶段以本目录自包含为准。

## 运行

```bash
# 在仓库根目录
pnpm install
pnpm --filter @zhin.js/queue-runtime build

cd examples/minimal-qbot
pnpm start
```

预期输出包含 `minimal-qbot OK`，且 `[done] done`。

## 链路与文档

- 出站：`enqueueOutgoing` → `claimOutgoing` → `executeOutbound`（[`packages/queue-runtime/src/runtime.ts`](../../packages/queue-runtime/src/runtime.ts)）
- 术语：[docs/architecture/queue/CONTEXT.md](../../docs/architecture/queue/CONTEXT.md)
- Beta 路线图：[docs/architecture/queue-roadmap.md](../../docs/architecture/queue-roadmap.md)

## 与 minimal-bot 的区别

| | minimal-bot | minimal-qbot |
|---|-------------|--------------|
| 运行时 | IM 栈（`zhin dev`） | queue-runtime |
| 对外档位 | **Stable** | **Beta**（非默认首跑） |
| 出站 | `Adapter.sendMessage` | `enqueueOutgoing` |
