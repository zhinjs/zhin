---
title: 开发流程
---

# 开发流程

改完代码到合进 main，中间有几道关卡：本地构建与测试、完整 harness 门禁、changeset、CI 发版。本页按这个顺序讲一遍日常闭环。

## 环境准备

- Node.js `^20.19.0` 或 `>=22.12.0`
- pnpm 9（仓库锁定 `packageManager: pnpm@9.0.2`）

```bash
pnpm install   # 安装全部 workspace 依赖
```

## 常用命令

```bash
pnpm dev        # 启动 examples/minimal-bot（Sandbox + Console），首次验证改动推荐它
pnpm dev:full   # 启动 examples/full-bot（L4 参考）
pnpm dev:test   # 启动 examples/test-bot（维护者厨房水槽）
pnpm build      # turbo 按 basic → packages → plugins 顺序构建全部包
pnpm test       # 全量 Vitest
pnpm type-check # tsc --noEmit（tsconfig.typecheck.json）
pnpm lint       # ESLint
```

只验证单个包时优先用 `pnpm --filter <pkg> build|test`，不要默认跑全量构建。

改 CLI 或 create-zhin-app 之前，如果报找不到 `@zhin.js/scaffold-wizard`，先构建它（产物在 `lib/`，未构建时 Node 无法解析）：

```bash
pnpm --filter @zhin.js/scaffold-wizard build   # 或 pnpm prepare:cli
```

## harness 门禁（pnpm check:all）

提交前最值得跑一次的是 `pnpm check:all`：它运行 `scripts/check-all-harness.mjs` 中登记的全部检查（含 type-check、lint、单测），全部通过才算绿——CI 跑的就是同一套。CI 若另跑 coverage 作业，可设 `HARNESS_SKIP_TEST=1` 跳过其中的 `pnpm test`，避免双跑。

下面按职责分组列出（括号内是单项命令，均可单独运行）。

**质量基线**

| 检查 | 说明 |
| --- | --- |
| Type Check（`pnpm type-check`） | `tsc --noEmit` |
| Lint（`pnpm lint`） | ESLint（.ts/.tsx） |
| Unit Tests（`pnpm test`） | 全量 Vitest |
| Production Config（`pnpm check:prod`） | 生产配置无调试代码 |

**架构与依赖**

| 检查 | 说明 |
| --- | --- |
| Architecture Layers（`pnpm check:architecture`） | 分层依赖方向（basic → kernel → ai → core → agent → zhin） |
| Dependency Policy（`pnpm check:dependency-policy`） | 用户项目脚手架依赖默认写 `latest` |
| No Koa Import（`pnpm check:no-koa`） | 插件不得直接 import koa |
| Install Size（`pnpm check:install-size`） | zhin.js IM 核心 production `node_modules` ≤ 10MB |

**API 快照与插件规范**

| 检查 | 说明 |
| --- | --- |
| API Surface（`pnpm check:api-surface`） | public API surface 快照 |
| Plugin Runtime API（`pnpm check:plugin-runtime-api`） | 约定式插件运行时 API surface 快照 |
| Plugin Spec（`pnpm check:plugin`） | 插件符合标准规范 |
| Plugin Agent Publish（`pnpm check:plugin-agent-publish`） | 带 `agent/` 的插件发布清单（files、prepublishOnly、peer 依赖） |
| Publish Repository（`pnpm check:publish-repository`） | 可发布包 `repository.url` 匹配 github.com/zhinjs/zhin（npm provenance） |
| Agent Tool Schema（`pnpm check:agent-tool-schema`） | `agent/tools` inputSchema 与 defineAgentTool/execute 类型一致 |
| No Package-Root skills/（`pnpm check:no-package-skills`） | 插件包禁止顶层 `skills/`，须用 `agent/skills/*.md` |

**IM 链路与运行时约定**

| 检查 | 说明 |
| --- | --- |
| IM Send Path（`pnpm check:harness-paths`） | 不得绕过 Adapter.sendMessage 统一链路 |
| IM Session SSOT（`pnpm check:im-session-ssot`） | IM 场景/session 身份解析走 core SSOT |
| usePlugin Top-Level（`pnpm check:use-plugin-top-level`） | 禁止调用已移除的 `usePlugin()`（throwing stub） |
| getPlugin Runtime（`pnpm check:get-plugin-runtime`） | 禁止调用已移除的 `getPlugin()`（含运行时回调；throwing stub） |
| Workroom SSOT（`pnpm check:workroom-ssot`） | Workroom 状态只经 Journal + CAS Kernel；禁止恢复并行可变权威 |

**AI 层**

| 检查 | 说明 |
| --- | --- |
| getModel Import Disambiguation（`pnpm check:get-model-imports`） | 运行时代码用 getLlmTransportModel，不用歧义 getModel |
| Legacy AI Exports（`pnpm check:legacy-ai-exports`） | `@zhin.js/ai` 不再导出 SessionManager 等符号 |
| Provider Gateway（`pnpm check:provider-gateway`） | LLM 网关 sdk/contextWindow 预设契约 |
| A2A Mesh（`pnpm check:a2a-mesh`） | 禁止残留 MCP Agent Mesh v1 符号 |

**适配器契约**

| 检查 | 说明 |
| --- | --- |
| Rich Segment Adapters（`pnpm check:rich-segments`） | outboundRichSegmentPolicy 声明与契约测试 |
| AI Outbound Adapters（`pnpm check:ai-outbound`） | aiOutboundExtensions 声明与契约测试 |
| Interactive Segments（`pnpm check:interactive-segments`） | interactivePolicy 声明与契约测试 |
| Segment Adapters（`pnpm check:segments`） | defineAdapter segments 声明契约（sandbox 必须达标） |

**文档一致性**

| 检查 | 说明 |
| --- | --- |
| Doc Links（`pnpm check:doc-links`） | 文档相对链接不断裂 |
| Doc Orphans（`pnpm check:doc-orphans`） | 站点 Markdown 都在侧栏或 allowlist |
| ADR Manifest（`pnpm check:adr-manifest`） | ADR README 与侧栏覆盖所有 ADR |
| README Exports（`pnpm check:readme-exports`） | README import 与包导出一致 |
| Config Docs（`pnpm check:config-docs`） | 配置文档与 DEFAULT_CONFIG 关键字段对齐 |
| Install Tiers SSOT（`pnpm check:install-tiers-ssot`） | 中文 `README.zh-CN.md` Install tiers 表与 `docs/snippets/install-tiers.md` 一致 |
| Adapter Docs Sync（`pnpm check:adapter-docs`） | 平台适配器文档与 `plugins/adapters/*/README.md` 同步（修复用 `pnpm sync:adapter-docs`） |
| Platform Tiers SSOT（`pnpm check:platform-tiers-ssot`） | 能力分档/适配器索引与 `scripts/adapter-meta.mjs` 一致 |
| Deployment Templates（`pnpm check:deployment-templates`） | Compose、systemd、Kubernetes 模板与中英文下载入口一致 |

**冒烟**

| 检查 | 说明 |
| --- | --- |
| Stable Smoke（`pnpm check:stable`） | Sandbox + Agent 核心单测 + minimal-bot 契约 |
| L4-CI（`pnpm check:l4-ci`） | L4 确定性子集（编排/记忆/full-bot 契约）；全量 `pnpm check:l4` 在 nightly 跑 |

## changeset 工作流

仓库用 [changesets](https://github.com/changesets/changesets) 管理版本与 changelog（配置见 `.changeset/config.json`：`baseBranch: main`、`access: public`）。任何影响已发布包行为的改动都要记 changeset：

```bash
pnpm release   # = pnpm changeset，交互式选择受影响的包与 semver 级别，生成 .changeset/*.md
pnpm bump      # = pnpm changeset version，消费 changeset、升版本号、写 CHANGELOG
pnpm pub       # = pnpm changeset publish，发布到 npm
```

日常开发只需 `pnpm release` 提交 changeset 文件；`bump` 和 `pub` 由 CI 执行。

## 发版（GitHub CI）

发版由 `.github/workflows/publish.yml` 驱动：`push` 到 `main` 或在 Actions 里 **workflow_dispatch 手动运行**。

```mermaid
flowchart LR
  trigger["push main / workflow_dispatch"] --> install["pnpm install"] --> build["pnpm build"]
  build --> harness["pnpm check:all"]
  harness --> gate["check:unpublished<br/>检测未首次发包"]
  gate -->|"有新包"| stop["失败并列出包名<br/>请手动首次发包后重跑"]
  gate -->|"全部已在 npm"| action["changesets/action"]
  action -->|"有未消费 changeset"| pr["开 version PR<br/>pnpm bump"]
  action -->|"main 合并 version PR"| pub["pnpm pub<br/>发布 npm"]
```

### 新包首次发包

npm 不再允许本流水线代发「第一次」：包名必须先由维护者用 token 手动发布一次，之后才走 changesets。

本地检测：

```bash
pnpm check:unpublished
```

若列出未发布包，构建后逐个首次发布，例如：

```bash
pnpm build
(cd path/to/pkg && npm publish --access public)
```

然后到 Actions → **Build and Publish** → **Run workflow** 重新执行（或再 push `main`）。

PR 门禁在 `.github/workflows/ci.yml`（Node 22/24 矩阵），同样跑 `pnpm check:all`。

## 调试

- **日志级别**：`zhin.config.yml` 的 `log_level` 调为 `debug`（默认 `info`），可看到框架内部细节日志。
- **Console 日志页**：运行期日志经 `DatabaseLogTransport` 写入 `SystemLog` 数据库模型，Remote Console 的 logs 页读取它。浏览器打开 [console.zhin.dev](https://console.zhin.dev)，填 API Base URL（如 `http://127.0.0.1:8086`）和 Bearer Token（`http.token` 配置）即可查看。
- **单包调试**：`pnpm --filter <pkg> test` 加 `-t '<用例名>'` 过滤用例；`pnpm test:watch` 进入 watch 模式。
