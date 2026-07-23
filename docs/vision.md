# 路线与边界（Vision）

> **EN summary below.** 本文是 Zhin.js 的定位宣言：我们是谁、为谁而建、靠什么与众不同、以及**明确不做什么**。所有对外叙事（README、文章、release note）以本文为准。

## 定位

Zhin.js 是**为生产环境构建严肃 bot / agent 产品的 TypeScript 框架**。目标用户不是写玩具 bot 的个人开发者，而是需要在生产环境长期运行、可维护、可审计的 bot / agent 产品的开发者与团队——尤其是需要覆盖中国 IM 平台（QQ / 企微 / 钉钉 / 飞书）并需要 agent 编排与安全合规的团队。

## 四根支柱

### 1. 分层可组合（Composable layers）

`basic → kernel → ai → core → agent → zhin` 单向依赖，由 `pnpm check:architecture` 强制。每一层都可独立使用：`@zhin.js/kernel` 可脱离 IM 作纯插件内核，`@zhin.js/ai` 可脱离 IM 作 LLM 引擎。框架不是单体应用——你可以只取你需要的层，嵌入自己的产品。

### 2. Agent-first（而非 AI 插件化）

`@zhin.js/agent` 是完整的 agent runtime：编排（orchestrator、task-queue）、工具与 MCP lifecycle、记忆与压缩（memory + compaction）、子代理（subagent / spawn）、A2A。AI 不是"接个 LLM SDK"的社区插件，而是框架的一等公民。

### 3. 安全内置（Built-in security）

五层防御：exec 白名单、文件策略、网络白名单、资源预算、审计日志；外加 Docker sandbox 与声明式策略表（`policy-facade` 统一入口）。安全不是文档建议，是框架强制。

### 4. 工程纪律即产品（Harness-enforced discipline）

50+ harness 门禁守护：架构分层、消息发送链路（禁止绕过统一出站）、`usePlugin()` 顶层调用、安装体积（IM 核心 `<10MB`）、依赖策略、文档与配置 SSOT。对生产团队而言，"框架自身可验证"比"插件数量多"重要得多。

## 边界（我们不做什么）

- **不是 coding agent**：不做 Cursor / Claude Code 类产品，聚焦 IM 场景的生活/工作助手与业务 bot。
- **不做插件市场全家桶**：不做中心化的插件商店与" thousands of plugins "运营；我们投入插件 SDK 质量与官方核心插件矩阵，生态由社区生长。
- **不做低代码平台**：不做 Dify / Coze 式可视化编排；Zhin 服务写代码的开发者。
- **不追 star 与插件数量**：以生产采用、外部贡献与工程口碑为度量。

## 度量

我们以这些指标判断路线是否被认可（而非 star）：npm 下载趋势、外部生产采用案例、外部合并 PR、GitHub dependents。维护者每 6 个月按此复盘一次。

---

## EN: Vision & Boundaries

Zhin.js is **the TypeScript framework for building production-grade agent products** — for developers and teams who run serious, long-lived, auditable bot/agent products in production, especially on Chinese IM platforms (QQ, WeCom, DingTalk, Feishu) with agent orchestration and security requirements.

Four pillars:

1. **Composable layers** — one-directional `basic → kernel → ai → core → agent → zhin` layering, enforced by harness checks. `@zhin.js/kernel` works standalone as a plugin engine; `@zhin.js/ai` as an IM-free LLM engine. Take only the layers you need.
2. **Agent-first** — `@zhin.js/agent` is a full agent runtime (orchestration, task queue, tools & MCP lifecycle, memory & compaction, subagents, A2A), not a "call an LLM SDK" plugin.
3. **Built-in security** — five defense layers (exec allowlist, file policy, network allowlist, resource budgets, audit log) plus Docker sandbox and a declarative policy table. Security is enforced by the framework, not left to documentation.
4. **Harness-enforced discipline** — 50+ harness gates guard architecture layering, the unified outbound message path, install size (IM core `<10MB`), dependency policy, and docs/config SSOT.

What we do **not** do: coding agents (Cursor/Claude Code style), a centralized plugin marketplace, low-code visual orchestration, or chasing star/plugin counts. We measure success by npm download trends, production adoption stories, external merged PRs, and GitHub dependents.
