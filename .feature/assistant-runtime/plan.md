# Assistant Runtime（路线 A）

## Goal

在 **不推倒 IM 栈** 的前提下，为 Zhin.js 增加 **Assistant Runtime** 脊柱，使个人助手场景的定时任务、外部事件、智能家居与多通道通知成为一等公民，而不是 `ZhinAgent.process()` 的旁路拼凑。

## 产品边界

| 范围 | 说明 |
|------|------|
| **Stable** | `assistant.enabled` 默认 `false`；minimal-bot 行为不变 |
| **Advanced** | test-bot / 个人部署可 opt-in；先 dogfood 再文档化 |
| **非目标** | 不替代 Home Assistant 自动化引擎；HA 仍可做传感器级联 |

## Capability Matrix

| 里程碑 | 能力 | 当前缺口 | 完成后 |
|--------|------|----------|--------|
| M0 | 决策与路线图 | 主动能力分散、无 SSOT | ADR + 架构文档 + todo |
| M1 | 统一 JobStore | cron / scheduler / HEARTBEAT 三套 JSON | `assistant-jobs.json` + 迁移 + TaskQueue |
| M2 | Event Ingress | 无 webhook 触发 Agent | `POST /api/assistant/events` |
| M3 | NotificationRouter | 仅 `CronJobContext` → IM | `notify.channel` 多通道 |
| M4 | Home Domain | 扁平 MCP 工具 | `assistant.home` + alias + policy |
| M5 | Assistant Profile | SOUL/AGENTS/TOOLS/HEARTBEAT 分散 | 可校验 Profile + Bootstrap 合并 |

## Harness 不变量

- IM 出站必须走 `Adapter.sendMessage` 链（ADR 0004）。
- 依赖层级 `basic → kernel → ai → core → agent → zhin`。
- `assistant.*` 配置遵循 ADR 0006 约定优先 merge。

## 参考

- [docs/architecture/assistant-runtime.md](../../docs/architecture/assistant-runtime.md)
- [docs/adr/0008-introduce-assistant-runtime.md](../../docs/adr/0008-introduce-assistant-runtime.md)
