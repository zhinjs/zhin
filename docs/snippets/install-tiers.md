# Install tiers（文档片段 SSOT）

用户向 **Install tiers / 安装分层** 文案的唯一来源。VitePress 页面用区域引用，勿在正文手抄表格。

```md
<<< ../snippets/install-tiers.md#tiers-table
```

维护：改表只改本文件，然后 `pnpm docs:build` 验证。仓库根 `README.md` 保留简表并注明 SSOT 路径。

<!-- #region tiers-table -->
| 档位 | 安装 | 约 production 体积 | 能力 |
|------|------|-------------------|------|
| **IM** | `pnpm add zhin.js` | **<10MB** | Plugin、Adapter、Endpoint、命令、Sandbox |
| **AI** | `+ @zhin.js/agent zod ai` | +~12–15MB | ZhinAgent、会话、工具、压缩 |
| **Provider** | `+ @ai-sdk/openai` 等 | 按厂商 | 大模型调用 |
| **MCP** | `+ @modelcontextprotocol/sdk` | +~数 MB | MCP Client / memoryMcp |
<!-- #endregion tiers-table -->

<!-- #region tiers-table-host -->
| 档位 | 安装 | 能力 |
|------|------|------|
| **IM** | `pnpm add zhin.js` | `@zhin.js/core` 全部 API |
| **AI** | `+ @zhin.js/agent zod ai` | ZhinAgent、`ctx.ai`、会话与工具 |
| **Provider** | `+ @ai-sdk/openai` 等 | 大模型调用 |
| **Host** | `+ @zhin.js/host-router @zhin.js/host-api` | Console API（可选 peer） |
<!-- #endregion tiers-table-host -->

<!-- #region breaking -->
Breaking（4.x）：`import from 'zhin.js'` **不再**含 `ZhinAgent` / `AIService` / `ModelRegistry`；请 `import from 'zhin.js/agent'` 或 `zhin.js/ai`。详见 [ADR 0019](/adr/0019-install-size-layering)。
<!-- #endregion breaking -->

<!-- #region breaking-short -->
Breaking（4.x）：`import from 'zhin.js'` 不再含 `ZhinAgent` / `AIService`；请 `import from 'zhin.js/agent'` 或 `zhin.js/ai`。详见 [ADR 0019](/adr/0019-install-size-layering)。
<!-- #endregion breaking-short -->

<!-- #region imports -->
| 用途 | 包 / 子路径 |
|------|-------------|
| Plugin、命令、`MessageCommand` | `zhin.js` |
| `ZhinAgent`、`AIService`、`registerAIHook`、`initAgentModule` | `zhin.js/agent` 或 `@zhin.js/agent` |
| `ModelRegistry`、`agentLoop`、`AIProvider` 类型 | `zhin.js/ai` 或 `@zhin.js/ai` |
<!-- #endregion imports -->

<!-- #region deps-install -->
```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # 示例：按 provider 替换
```
<!-- #endregion deps-install -->

<!-- #region doctor -->
`zhin doctor --fix` 或 `zhin config check --fix` 可根据 `ai.enabled` 自动补全 `package.json`。
<!-- #endregion doctor -->

<!-- #region scaffold-note -->
`npm create zhin-app` / `zhin setup` 在启用 AI 时会自动写入 `package.json` 依赖。

仓库示例：[minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 默认 **仅 IM**（`ai.enabled: false`）；[full-bot](https://github.com/zhinjs/zhin/tree/main/examples/full-bot) 含完整 AI 栈。
<!-- #endregion scaffold-note -->

<!-- #region callout-one-liner -->
**zhin.js 4.x 安装分层**：`pnpm add zhin.js` 仅 IM 核心（<10MB）；AI 另装 `@zhin.js/agent zod ai` 与所选 `@ai-sdk/*`。见 [ADR 0019](/adr/0019-install-size-layering) 与 [快速开始 — Install tiers](/getting-started/#install-tierszhinjs-4x)。
<!-- #endregion callout-one-liner -->
