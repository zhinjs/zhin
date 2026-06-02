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
- [examples/test-bot](examples/test-bot/) 为维护者厨房水槽（多 bot / Advanced 能力），非默认模板。

## 常用命令

- 在仓库根 `pnpm install` 后，进入 `examples/minimal-bot` 执行 `pnpm dev`（Sandbox + 控制台）。
- `pnpm dev`（根目录）仍指向 test-bot 热重载，用于全功能回归。
- `pnpm build`：按 basic → packages → plugins 的顺序构建全部包。
- `pnpm test`：运行 Vitest。
- `pnpm type-check`：运行 TypeScript 类型检查。
- `pnpm lint`：运行 ESLint。
- `pnpm check:doc-links`：检查文档相对链接是否断裂。
- `pnpm --filter <pkg> build|test`：只验证单个包。

优先做最小范围验证，不要默认跑全量构建。

## 必须遵守的约束

- TypeScript 本地导入通常必须使用 .js 扩展名。
- usePlugin() 应在模块顶层调用，不要放进异步函数、回调工厂或延迟执行路径。
- 发送消息不能绕过统一链路：Message.$reply 或 Adapter.sendMessage → renderSendMessage → before.sendMessage → 平台 Bot。
- 保持依赖方向单向：basic → kernel → ai → core → agent → zhin；不要让低层依赖 IM 概念。
- Node 侧源码放 src/，产物放 lib/；浏览器侧源码放 client/，产物放 dist/。
- 新增 workspace 包必须落在 pnpm-workspace.yaml 覆盖的目录里，并带独立 package.json。

## 任务路由

- 框架核心、Plugin/Adapter/Dispatcher：看 packages/core。
- AI 引擎、Session、Compaction、Provider：看 packages/ai。
- AI 编排、工具发现、安全策略、MCP client：看 packages/agent。
- 应用入口和聚合导出：看 packages/zhin。
- Host 运行时（router / api / mcp）：看 packages/host。
- 可选服务插件：看 plugins/services。
- 平台适配器：看 plugins/adapters。
- 插件开发样例和本地验证：优先 examples/minimal-bot；全量见 examples/test-bot。

## 高价值路径

- packages/im/core/src/plugin.ts
- packages/im/core/src/adapter.ts
- packages/im/core/src/built/dispatcher.ts
- packages/im/agent/src/orchestrator/
- packages/im/agent/src/security/
- packages/im/agent/src/bootstrap.ts
- packages/im/zhin/src/index.ts

## 现成自定义能力

- 自定义 agents 在 .github/agents/ 和仓库根 agents/。
- 自定义 skills 在 .github/skills/。
- 插件文件专用说明在 .github/instructions/zhin-plugin.instructions.md。

根据任务优先复用这些现成能力，而不是重复发明提示词。

## Issue 与流程约定

- Issues 和 PRD 流程见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。
- Triage 标签只使用 needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix。
- 非琐碎功能或重构若涉及仓库流程工件，遵循 .cursor/skills/reliable-dev-workflow/SKILL.md。
