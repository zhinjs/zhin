# Zhin.js Agent Guide

本文件是本仓库给 AI 编码代理的最小入口。详细说明尽量链接到现有文档，不在这里重复展开。

## 先读哪些文件

按这个顺序建立心智模型：

1. [docs/architecture/README.md](docs/architecture/README.md)
2. [docs/architecture-overview.md](docs/architecture-overview.md)
3. [docs/contributing/repo-structure.md](docs/contributing/repo-structure.md)
4. [README.md](README.md)
5. 与当前改动最近的包 README 或 docs 页面

如果任务属于插件实现，再读 [.github/instructions/zhin-plugin.instructions.md](.github/instructions/zhin-plugin.instructions.md)。

## 仓库事实

- 这是 pnpm workspace monorepo；`packages/` 按 `im/`、`console/`、`toolkit/` 分子目录。Remote UI 可选 submodule：`zhin-console/`。
- Node 版本要求是 ^20.19.0 或 >=22.12.0；包管理器是 pnpm 9。
- 主要分层：basic → kernel → ai → core → agent → zhin。
- **推荐首跑**： [examples/minimal-bot](examples/minimal-bot/)（Stable 黄金路径）。
- **L4 参考**： [examples/full-bot](examples/full-bot/)（分维度 L4 DoD；`pnpm check:l4`）。
- [examples/test-bot](examples/test-bot/) 为维护者厨房水槽（多 Endpoint / Advanced 能力），非默认模板。
- 进阶路径：**Stable（minimal-bot）→ L4（full-bot）→ 厨房水槽（test-bot）**。
- **项目脚手架**：新建 workspace 用 `pnpm create zhin-app`（`create-zhin-app`）；已有项目增量配置用 `zhin setup`。二者共用 [`@zhin.js/scaffold-wizard`](packages/toolkit/scaffold-wizard/)。

## 常用命令

- 在仓库根 `pnpm install` 后，进入 `examples/minimal-bot` 执行 `pnpm dev`（Sandbox + 控制台）。
- `pnpm dev`（根目录）仍指向 test-bot 热重载，用于全功能回归。
- `pnpm build`：按 basic → packages → plugins 的顺序构建全部包。
- `pnpm test`：运行 Vitest。
- `pnpm type-check`：运行 TypeScript 类型检查。
- `pnpm lint`：运行 ESLint。
- `pnpm check:doc-links`：检查文档相对链接是否断裂。
- `pnpm sync:adapter-docs` / `pnpm check:adapter-docs`：平台适配器文档与 `plugins/adapters/*/README.md` 同步。
- `pnpm --filter <pkg> build|test`：只验证单个包。
- `pnpm check:l4`：L4 全维度验收（编排 + 语义记忆 + full-bot 契约 + MCP 鉴权；实机 IM 项 `L4_SKIP_PLATFORM=1` 跳过）。
- 改 **CLI** 或 **create-zhin-app** 前，若报找不到 `@zhin.js/scaffold-wizard`，先执行 `pnpm --filter @zhin.js/scaffold-wizard build`（或 `pnpm prepare:cli` / 全量 `pnpm build`）。该包产物在 `lib/`，未构建时 Node 无法解析。
- **ADR 0010 Harness**：IM 会话命令见 [examples/test-bot/TOOLS.md](examples/test-bot/TOOLS.md)；`zhin packages` 见 [docs/adr/0010-pi-coding-agent-harness-alignment.md](docs/adr/0010-pi-coding-agent-harness-alignment.md)。

优先做最小范围验证，不要默认跑全量构建。

## 必须遵守的约束

- TypeScript 本地导入通常必须使用 .js 扩展名。
- usePlugin() 应在模块顶层调用，不要放进异步函数、回调工厂或延迟执行路径。
- 发送消息不能绕过统一链路：Message.$reply 或 Adapter.sendMessage → renderSendMessage → before.sendMessage → 平台 Endpoint。
- Endpoint 可按 `capabilities`（`inbound` / `outbound`）拆分 IO；跨平台出站用 `inject(adapter).sendMessage`，见 `docs/essentials/message-flow.md`。
- 保持依赖方向单向：basic → kernel → ai → core → agent → zhin；不要让低层依赖 IM 概念。
- Node 侧源码放 src/，产物放 lib/；浏览器侧源码放 client/，产物放 dist/。
- 新增 workspace 包必须落在 pnpm-workspace.yaml 覆盖的目录里，并带独立 package.json。

## 任务路由

- 框架核心、Plugin/Adapter/Dispatcher：看 packages/im/core。
- AI 引擎、Session、Compaction、Provider、ModelRegistry、`getModel`：看 [packages/im/ai](packages/im/ai/README.md) 与 [docs/advanced/ai.md](docs/advanced/ai.md)。
- AI 编排、工具发现、安全策略、MCP client：看 [packages/im/agent](packages/im/agent/README.md)。
- 应用入口和聚合导出：看 [packages/im/zhin](packages/im/zhin/README.md)（含 `im_transcripts` 落库）。
- Host 运行时（router / api / mcp）：看 packages/host。
- 可选服务插件：看 plugins/services。
- 平台适配器：看 plugins/adapters。
- 插件开发样例和本地验证：优先 examples/minimal-bot；L4 全维度见 examples/full-bot；全量见 examples/test-bot。
- **项目创建 / 配置向导**（适配器、AI、database 交互与写配置）：看 `packages/toolkit/scaffold-wizard/`；`create-zhin-app` 与 `basic/cli` 的 `setup` 均依赖它。

## 高价值路径

- packages/im/core/src/plugin.ts
- packages/im/core/src/adapter.ts
- packages/im/core/src/built/dispatcher.ts
- packages/im/agent/src/orchestrator/
- packages/im/agent/src/security/
- packages/im/agent/src/bootstrap.ts
- packages/im/zhin/src/index.ts
- packages/im/zhin/src/setup/register-chat-message-store.ts
- packages/im/ai/src/llm/api-registry.ts
- packages/im/agent/src/service.ts（`refreshLlmApiRegistry` / `hasExplicitModelList`）
- packages/im/zhin/src/setup/register-chat-message-store.ts
- packages/im/ai/src/llm/api-registry.ts
- packages/im/agent/src/service.ts（`refreshLlmApiRegistry` / `hasExplicitModelList`）
- packages/toolkit/scaffold-wizard/src/（`adapter.ts`、`ai.ts`、`apply.ts` — 改向导时优先改这里）
- packages/toolkit/create-zhin/src/workspace.ts（生成项目文件树，不含向导逻辑）
- basic/cli/src/commands/setup.ts（已有项目增量向导入口）

## 现成自定义能力

- 自定义 agents 在 .github/agents/ 和仓库根 agents/。
- 自定义 skills 在 .github/skills/。
- 插件文件专用说明在 .github/instructions/zhin-plugin.instructions.md。

根据任务优先复用这些现成能力，而不是重复发明提示词。

## Issue 与流程约定

- Issues 和 PRD 流程见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。
- Triage 标签只使用 needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix。
- 非琐碎功能或重构若涉及仓库流程工件，遵循 .cursor/skills/reliable-dev-workflow/SKILL.md。
