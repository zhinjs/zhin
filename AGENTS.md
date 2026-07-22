# Zhin.js Agent Guide

本文件是本仓库给 AI 编码代理的最小入口。详细说明尽量链接到现有文档，不在这里重复展开。

## 项目概览

**Zhin.js** 是 TypeScript 多通道 IM Bot 框架（私聊、群聊、记忆、定时、通知），定位是生活/工作助手 Bot——**不是** Cursor / Claude Code 类 coding agent。核心特性：插件热重载、Sandbox、Remote Console、可选 AI Agent 栈。

- 版本：4.x。默认安装仅 IM 核心（production `node_modules` <10MB），AI 按需加装 `@zhin.js/agent` + `zod` + `ai` + 所选 `@ai-sdk/*`（ADR 0019 安装分层）。
- 这是 pnpm workspace monorepo（pnpm 9，`pnpm-workspace.yaml` 为准），构建编排用 turbo。
- Node 版本要求：`^20.19.0` 或 `>=22.12.0`。
- 发布流：changesets（`pnpm release` 记 changeset，`pnpm bump` 升版本，`pnpm pub` 发布）。

## 先读哪些文件

按这个顺序建立心智模型：

1. [docs/architecture/README.md](docs/architecture/README.md)
2. [docs/architecture-overview.md](docs/architecture-overview.md)
3. [docs/contributing/repo-structure.md](docs/contributing/repo-structure.md)
4. [README.md](README.md)
5. 与当前改动最近的包 README 或 docs 页面
6. 符号/调用链速查：`.codegraph/MEMORY.md`（CodeGraph 本地索引，需先 `codegraph init`；不入库）

如果任务属于插件实现，再读 [.github/instructions/zhin-plugin.instructions.md](.github/instructions/zhin-plugin.instructions.md)。

## 仓库结构与技术栈

- 全仓库 TypeScript（ESM），测试 Vitest，Lint ESLint 10 + typescript-eslint，构建产物经 turbo 并行。
- workspace 覆盖：`basic/*`、`packages/im/*`、`packages/console/*`、`packages/toolkit/*`、`packages/host/*`、`packages/game-kit`、`plugins/{adapters,features,games,services,utils}/*`、`examples/*`、`docs`。
- `basic/`：基础层（cli / database / logger / schedule / schema）。
- `packages/im/`：IM 核心层（adapter、agent、ai、command、component、config-yaml、core、feature-kit、isolate、kernel、mcp-feature、middleware、plugin-runtime、runtime、skill、tool、zhin 等子包）。
- `packages/host/`：Host 运行时（http / router / api / mcp / a2a）。
- `packages/console/`：Remote Console（Host 只提供 API，UI 在 console.zhin.dev）。
- `packages/toolkit/`：create-zhin（`pnpm create zhin-app`）、scaffold-wizard（配置向导）、satori、html-renderer、speech。
- `plugins/adapters/`：平台适配器（Sandbox / QQ / ICQQ / NapCat / OneBot11·12 / Discord / Telegram / Slack / KOOK / 钉钉 / 飞书 / GitHub / Email / 企微 / LINE / Satori 等）。
- `examples/`：参考实现，见下方「示例分层」。
- 可选 Remote UI submodule：`zhin-console/`。

### 分层架构（依赖方向单向，由 harness 强制）

```
basic → kernel → ai → core → agent → zhin（→ host/router → host/mcp → host/api）
```

| 层 | 包 | 一句话 |
|----|-----|--------|
| 基础层 | `basic/*`（`@zhin.js/logger` `database` `schema` `cli`） | 日志、数据库、配置校验、命令行 |
| 内核 | `@zhin.js/kernel` | 插件系统、定时任务、错误体系（无 IM 概念） |
| AI 引擎 | `@zhin.js/ai` | Provider、agentLoop、会话、记忆（无 IM 概念） |
| IM 层 | `@zhin.js/core` | Plugin、Adapter、Endpoint、命令、中间件 |
| Agent | `@zhin.js/agent` | ZhinAgent、多模型编排、安全沙箱、MCP |
| 应用 | `zhin.js` | 启动入口、配置解析、插件加载 |

依赖方向由 `pnpm check:architecture` 强制检查，不要逆向依赖、不要让低层依赖 IM 概念。例外：`basic/cli` 是 Plugin Runtime composition root（`zhin runtime start` 装配 IM/Agent/Console Host），允许导入 packages/im 各层，仅限 basic/cli。

### 示例分层（跑哪个 example 取决于任务层级）

- **Stable 黄金路径**：[examples/minimal-bot](examples/minimal-bot/)（仅 IM；根目录 `pnpm dev` 指向它）。**推荐首跑**。
- **L4 参考**：[examples/full-bot](examples/full-bot/)（分维度 L4 DoD；`pnpm check:l4`）。
- [examples/test-bot](examples/test-bot/)：维护者厨房水槽（多 Endpoint / Advanced 能力），**非默认模板**；根目录用 `pnpm dev:test` 进入。
- 进阶路径：**Stable（minimal-bot，仅 IM）→ L4（full-bot，含 AI）→ 厨房水槽（test-bot）**。

### zhin.js 4.x 安装分档

- 默认安装仅 IM（<10MB）；AI 另装 `@zhin.js/agent` + `zod` + `ai` + 所选 `@ai-sdk/*`。
- 用户向分档表 SSOT：[`docs/snippets/install-tiers.md`](docs/snippets/install-tiers.md)（根 README 的 Install tiers 表必须与之一致，`pnpm check:install-tiers-ssot` 门禁）。
- 见 [ADR 0019](docs/adr/0019-install-size-layering.md)。Breaking（4.x）：`import from 'zhin.js'` 不再含 `ZhinAgent` / `AIService`；请 `import from 'zhin.js/agent'` 或 `zhin.js/ai`。
- `pnpm check:install-size`：IM 核心 production `node_modules` ≤10MB。

### 项目脚手架

- 新建 workspace 用 `pnpm create zhin-app`（`create-zhin-app`，源码在 `packages/toolkit/create-zhin`）；已有项目增量配置用 `zhin setup`。二者共用 [`@zhin.js/scaffold-wizard`](packages/toolkit/scaffold-wizard/)。

## 常用命令

- 在仓库根 `pnpm install` 后执行 `pnpm dev`（指向 [examples/minimal-bot](examples/minimal-bot/)，Sandbox + 控制台）。
- `pnpm dev:test` / `pnpm dev:full`：维护者厨房水槽 test-bot / L4 full-bot。**勿将 test-bot 配置当作用户模板**；对外文档与脚手架以 minimal-bot / full-bot 为准。
- `pnpm build`：按 basic → packages → plugins 的顺序构建全部包（turbo）。
- `pnpm test`：运行 Vitest。
- `pnpm check:all`：全套 harness（**含** `type-check` / `lint` / `test`）+ 架构门禁；CI coverage 作业可用 `HARNESS_SKIP_TEST=1` 跳过其中单测。
- `pnpm type-check` / `pnpm lint` / `pnpm test`：也可单独跑（已含于 check:all）。
- `pnpm check:doc-links`：检查文档相对链接是否断裂。
- `pnpm sync:adapter-docs` / `pnpm check:adapter-docs`：平台适配器文档与 `plugins/adapters/*/README.md` 同步。
- `pnpm check:plugin-agent-publish`：带 `agent/` 的插件 `package.json` 须含 `files`（`agent`、`lib` 等）与 `prepublishOnly`。
- `pnpm --filter <pkg> build|test`：只验证单个包。
- `pnpm check:l4-ci`：PR 门禁 L4 确定性子集（编排/记忆/full-bot 契约）。
- `pnpm check:l4`：L4 全维度验收（编排 + 语义记忆 + full-bot 契约 + MCP 鉴权 + adapter L4；实机 IM 项 `L4_SKIP_PLATFORM=1` 跳过）；nightly workflow 跑全量。
- 暂无官方 Docker 镜像；自建容器见 [docs/getting-started/docker.md](docs/getting-started/docker.md)。
- `pnpm check:install-size`：zhin.js IM 核心 production `node_modules` ≤10MB（ADR 0019）。
- `pnpm check:install-tiers-ssot`：根 `README` Install tiers 表与 `docs/snippets/install-tiers.md` 一致。
- 改 **CLI** 或 **create-zhin-app** 前，若报找不到 `@zhin.js/scaffold-wizard`，先执行 `pnpm --filter @zhin.js/scaffold-wizard build`（或 `pnpm prepare:cli` / 全量 `pnpm build`）。该包产物在 `lib/`，未构建时 Node 无法解析。
- **ADR 0010 Harness**：IM 会话命令见 [examples/test-bot/TOOLS.md](examples/test-bot/TOOLS.md)；`zhin packages` 见 [docs/adr/0010-pi-coding-agent-harness-alignment.md](docs/adr/0010-pi-coding-agent-harness-alignment.md)。

优先做最小范围验证，不要默认跑全量构建。

## 必须遵守的约束（代码约定）

- TypeScript 本地导入通常必须使用 `.js` 扩展名。
- `usePlugin()` 应在模块顶层调用，不要放进异步函数、回调工厂或延迟执行路径（`pnpm check:use-plugin-top-level` 门禁）。
- `getPlugin()` 只能在插件初始化/装配阶段调用；中间件、命令 action、工具 execute、Cron、事件回调等运行时路径严禁 `getPlugin()`，应在注册时捕获 plugin/root 闭包（`pnpm check:get-plugin-runtime` 门禁）。
- 发送消息不能绕过统一链路：`Message.$reply` 或 `Adapter.sendMessage` → `renderSendMessage` → `before.sendMessage` → 平台 Endpoint（`pnpm check:harness-paths` 门禁）。
- Endpoint 可按 `capabilities`（`inbound` / `outbound`）拆分 IO；跨平台出站用 `inject(adapter).sendMessage`，见 `docs/essentials/message-flow.md`。
- 保持依赖方向单向：basic → kernel → ai → core → agent → zhin；不要让低层依赖 IM 概念。例外仅限 `basic/cli`（见上）。
- Node 侧源码放 `src/`，产物放 `lib/`；浏览器侧源码放 `client/`，产物放 `dist/`。
- 新增 workspace 包必须落在 `pnpm-workspace.yaml` 覆盖的目录里，并带独立 `package.json`。
- 依赖策略受 `pnpm check:dependency-policy` 门禁约束；根 `pnpm-workspace.yaml` 的 `overrides` 承担大量安全版本抬升，不要随手删改。

## 测试约定

- 测试用 Vitest，配置在根 `vitest.config.ts`：`globals: true`（无需 import `describe/it/expect`），Node 环境，匹配 `**/*.test.ts`，文件级隔离开启（`isolate: true`，避免 `vi.spyOn`/`vi.mock` 跨文件泄漏）。
- 覆盖率阈值：lines 45% / branches 35%（v8 provider）。
- 单包测试优先 `pnpm --filter <pkg> test`；全量 `pnpm test`，CI 走 `pnpm check:all`（可用 `HARNESS_SKIP_TEST=1` 跳过单测段）。
- 文档/配置对齐类测试在 `tests/docs/`（如 `pnpm check:config-docs`）。

## 安全注意事项

- 密钥走环境变量并在 `zhin.config.yml` 中以 `${VAR}` 引用（如 `apiKey: ${AI_API_KEY}`），不要硬编码。
- Agent 执行安全：builtin 工具默认 `execSecurity: allowlist`、`execApprovalMode: ask`；工具安全检查统一走 `packages/im/agent/src/security/policy-facade.ts` 的 `runToolPolicies`，新增策略只在声明式策略表注册，builtin 工具不再手写策略链。
- 新增依赖时注意 `pnpm-workspace.yaml` 中已有的安全 `overrides`（undici / hono / tar / js-yaml / nodemailer 等大量抬升条目）。

## 任务路由

- 框架核心、Plugin/Adapter/Dispatcher：看 packages/im/core。
- AI 引擎、Session、Compaction、Provider、ModelRegistry、`getModel`：看 [packages/im/ai](packages/im/ai/README.md) 与 [docs/advanced/ai.md](docs/advanced/ai.md)。
- AI 编排、工具发现、安全策略、MCP client：看 [packages/im/agent](packages/im/agent/README.md)。
- **插件 AI 创作面**（`agent/tools`、`agent/skills`）：看 [docs/advanced/agent-authoring.md](docs/advanced/agent-authoring.md)。
- 应用入口（IM 核心 + 可选 agent 子路径）：看 [packages/im/zhin](packages/im/zhin/README.md)（`im_transcripts` 落库需 `@zhin.js/agent`）。
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
- packages/im/agent/src/security/（工具安全检查统一走 `policy-facade.ts` 的 `runToolPolicies`；新增策略只在声明式策略表注册，builtin 工具不再手写策略链）
- packages/im/agent/src/bootstrap.ts
- packages/im/zhin/src/index.ts
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
