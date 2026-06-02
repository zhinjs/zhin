# Queue 运行时路线图（Beta）

`packages/queue-runtime` 与 IM 主栈**平行**，面向「入站事件 → 出站任务队列 → Worker 执行」场景。本页为 **Beta** 档说明；**不是** Stable 对外承诺。

## 目标（Beta）

- 提供可测的出站 API：`enqueueOutgoing` → `claimOutgoing` → `executeOutbound`
- 与 IM 出站字段对齐（见 [im-queue-outbound-invariants.md](./im-queue-outbound-invariants.md)）
- 示例 [`examples/minimal-qbot`](https://github.com/zhinjs/zhin/tree/main/examples/minimal-qbot) 可本地 `pnpm start` 跑通
- Vitest smoke：`packages/queue-runtime/tests/`

## 非目标（Beta 不做）

- 与 `zhin dev` / `MessageDispatcher` 合并为单一运行时
- 升 **Stable**（对外默认仍用 [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot)）
- 全平台适配器生产级联调
- 统一 `loadQBotConfig` 与 `zhin.config` queue 段（可后续 issue）

## 配置现状（2026-06）

| 方式 | 状态 |
|------|------|
| `qbot.config.yml` | minimal-qbot 示例内联 `load-qbot-config.ts` |
| `zhin.config` queue 段 | 未接入启动链 |
| `loadQBotConfig()` | 仓库内无此符号 |

## 术语与契约

- [queue/CONTEXT.md](./queue/CONTEXT.md) — Envelope、Outbound Detail、Field Contract
- [event-contracts.md](./event-contracts.md) — 事件 kind / type / detail
- [im-queue-outbound-invariants.md](./im-queue-outbound-invariants.md) — 与 Core `SendOptions` 对齐

## 代码锚点

| 用途 | 路径 |
|------|------|
| 运行时 | `packages/queue-runtime/src/runtime.ts` |
| HTTP 路由（可选） | `packages/queue-runtime/src/queue-routes.ts` |
| 出站类型 | `packages/queue-runtime/src/types.ts` |

## 验收

```bash
pnpm check:doc-links
pnpm --filter @zhin.js/queue-runtime test
cd examples/minimal-qbot && pnpm start
```
