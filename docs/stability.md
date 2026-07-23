# 稳定性承诺（Stability Policy）

> 本文把 Zhin.js 内部的工程纪律翻译成对使用者的外部承诺：**哪些 API 可以放心依赖，变更如何通知，出了问题找哪里。**

## Semver 政策

- 所有已发布包遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：breaking 只出现在 major；minor 只加向后兼容能力；patch 只做修复。
- **Deprecation 提前量**：公开 API 废弃前，至少提前 **一个 minor 版本**以 `@deprecated` JSDoc + 文档标注，并给出迁移路径；不会在 patch 版本中移除任何已发布 API。
- 仓库内部惯例：monorepo 内的跨包 breaking 迁移可能统一使用 patch bump（避免主包 major 级联，见仓库发布惯例说明）；此类变更**一定**在 changeset 与里程碑 [CHANGELOG](https://github.com/zhinjs/zhin/blob/main/CHANGELOG.md) 中显著标注 breaking 与迁移指引。

## API 稳定度分级

| 级别 | 含义 | 包 / 能力 |
|------|------|-----------|
| **Stable** | 承诺 semver 与 deprecation 政策；有 harness 门禁与测试覆盖 | `zhin.js`（IM 入口）、`@zhin.js/core`、`@zhin.js/ai`、`@zhin.js/kernel`、`basic/*`、官方平台适配器（`plugins/adapters/*`） |
| **Beta** | API 基本稳定，可能在 minor 中调整；文档如实标注 | `@zhin.js/agent`（编排/安全/MCP 主链路）、Host 栈（router / api / mcp / http）、Console contract |
| **Experimental** | 可能随时变更，不做兼容性承诺；不进 README 首屏叙事 | A2A mesh、多 agent room（`multi-agent-room`）、语音管线（`@zhin.js/speech`）、`@zhin.js/satori` / `html-renderer` 渲染链 |

> 判断某个具体能力的级别，以其所在文档页面与包的 README 标注为准；未标注的按所在包的级别处理。

## 测试与质量基线

- 测试框架 Vitest，全仓 600+ 测试文件，文件级隔离。
- 覆盖率门槛（v8）：当前全仓基线 lines 45% / branches 35%，**计划阶梯提升**——Stable 级包（core / kernel / ai）目标 70/60，全仓目标 60/50。未达目标前不封锁 PR，但门槛只升不降。
- Harness 门禁（50+）守护：架构分层单向依赖、统一出站链路（禁止绕过 `renderSendMessage`）、`usePlugin()` 顶层调用、安装体积（IM 核心 `<10MB`，ADR 0019）、依赖策略、文档/配置 SSOT。CI 全绿才允许合并。

## L4 验收（DoD）

Zhin.js 用能力分档（Stable / Advanced / L4）定义"完成"的含义：L4 是最高验收维度，覆盖编排、语义记忆、full-bot 契约、MCP 鉴权与适配器实机项。CI 门禁运行 L4 确定性子集（`pnpm check:l4-ci`），全量验收（`pnpm check:l4`）在 nightly 运行。详见 [能力分档](/essentials/capability-tiers) 与 [ADR 0015](/adr/0015-capability-tier-model)。

## 版本支持与升级

- Node.js 要求：`^20.19.0` 或 `>=22.12.0`。
- 主包 major 版本（当前 4.x）在下一个 major 发布前持续接收修复；旧 major 不承诺 backport，但关键安全问题会评估处理（见 [SECURITY.md](https://github.com/zhinjs/zhin/blob/main/SECURITY.md)）。
- 逐包发布记录由 changesets 维护在各包 `CHANGELOG.md`；根 [CHANGELOG.md](https://github.com/zhinjs/zhin/blob/main/CHANGELOG.md) 只记里程碑与 breaking 迁移指引。

## 安全问题

安全漏洞请按 [SECURITY.md](https://github.com/zhinjs/zhin/blob/main/SECURITY.md) 私下报告，不要开公开 issue。
