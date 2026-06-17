# ADR 0019：安装体积分层与 Schema 统一

## 状态

Accepted

## 背景

- Zhin 对第三方依赖有强洁癖；自研 `@zhin.js/schema`（零依赖）用于配置校验。
- `pnpm add zhin.js` 当前拉起约 **28MB** production `node_modules`（`ai`、`zod`、五个 `@ai-sdk/*`、`typebox` 等）。
- 目标：**IM 核心安装 <10MB**；AI/Agent/MCP/Provider 分层 optional。

## 决策

### D1. 预算口径

以用户项目 `pnpm add` 后 **production `node_modules` 增量** 为准，非 tarball 体积。

### D2. 包分层

| 层级 | 包 | 安装物 |
|------|-----|--------|
| IM 核心 | `zhin.js` | `@zhin.js/core`、`kernel`、`schema`、`logger`、`database`（第三方约 1–2MB） |
| AI 编排 | `@zhin.js/agent` | peer / 显式安装 |
| AI 引擎 | `@zhin.js/ai` | 由 agent 依赖或单独安装 |
| Provider | `@ai-sdk/*` | **optional peer**，用哪个装哪个 |
| MCP Server | `@modelcontextprotocol/sdk` | **optional peer** |

`zhin.js` **4.x breaking**：默认 export 不再含 `ZhinAgent` / `AIService`；请 `pnpm add @zhin.js/agent` 或 `import from 'zhin.js/agent'`。

### D3. core 与 ai 解耦

- `@zhin.js/core` **不得**依赖 `@zhin.js/ai`。
- `resolveIMSessionId*` 迁入 core（`im-session-id.ts`）；ai 再导出以保持兼容。
- `AgentPromptContributor` 使用 core 内最小 `DeferredToolCatalogItem`，不引用 `AgentTool`。

### D4. TypeBox → Zod（仅 `@zhin.js/ai`）

- 移除 `@sinclair/typebox`。
- `LlmTool.parameters` 使用 `z.ZodType`；`validateToolCall` 使用 `z.safeParse`。
- IM 层 `ToolParametersSchema`（JSON Schema）在 bridge 层转 Zod。
- **`@zhin.js/schema` 不变**（配置专用、零依赖）。

### D5. 验证

- `pnpm check:install-size`：IM 闭包 ≤10MB；agent+单 provider 另设上限（文档化）。

## 后果

- 现有 bot 需显式依赖 `@zhin.js/agent` 与所选 `@ai-sdk/*`。
- ADR 0009 D5（TypeBox 工具链）由本 ADR 修订。
- `create-zhin-app` / full-bot 模板默认装全栈；minimal-bot 仅 IM。
- **用户向 Install tiers 表**：SSOT 为 `docs/snippets/install-tiers.md`（VitePress 页面 `<<<` 引用）；改表只改该文件。

## 相关

- [ADR 0009](./0009-pi-aligned-ai-agent-core.md)
- [ADR 0018](./0018-ai-sdk-transport-layer.md)
- 文档片段：`docs/snippets/install-tiers.md`（维护说明见同目录 `README.md`）
- 用户文档：[快速开始 — Install tiers](/getting-started/#install-tierszhinjs-4x)、[AI 模块](/advanced/ai#安装与依赖-zhinjs-4x)、[配置文件 — AI 节](/essentials/configuration#ai-配置)
