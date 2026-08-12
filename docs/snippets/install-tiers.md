# Install tiers（文档片段 SSOT）

用户向 **Install tiers / 安装分层** 文案的唯一来源。VitePress 页面用区域引用，勿在正文手抄表格。

```md
<<< ../snippets/install-tiers.md#tiers-table
```

维护：改表只改本文件，然后 `pnpm docs:build` 验证。仓库根 `README.md` 保留简表并注明 SSOT 路径。

<!-- #region tiers-table -->
| 档位 | 安装 | 约 production 体积 | 能力 |
|------|------|-------------------|------|
| **IM** | `pnpm add zhin.js` + 适配器（如 `@zhin.js/adapter-sandbox`）；dev：`@zhin.js/cli` | **<10MB**（库包） | Plugin Runtime、命令/组件/适配器约定目录（Stable Features 由 `@zhin.js/core` 的 `zhin.features` 继承；Host 为 optional peer + `zhin.plugins`，见 [ADR 0053](/adr/0053-platform-stable-features)） |
| **AI** | `+ @zhin.js/agent zod ai` | +~12–15MB | ZhinAgent、会话、工具、压缩 |
| **Provider** | `+ @ai-sdk/openai` 等 | 按厂商 | 大模型调用 |
| **MCP** | `+ @modelcontextprotocol/sdk` | +~数 MB | MCP Client |
| **Rich media** | `+ @zhin.js/html-renderer` | +~数 MB | 出站 `html` / `markdown` 转 PNG（未装则降级 text） |
| **Speech** | `+ @zhin.js/speech` | +~数 MB | 入站 STT、出站 TTS、`segment.tts`（未装则 warn 降级） |
<!-- #endregion tiers-table -->

<!-- #region tiers-table-host -->
| 档位 | 安装 | 能力 |
|------|------|------|
| **IM** | `pnpm add zhin.js` + 适配器；`@zhin.js/cli` 装配 Host | 创作面 API 经 `zhin.js/*`；Console Host 由 CLI 注入 |
| **AI** | `+ @zhin.js/agent zod ai` | ZhinAgent、会话与工具 |
| **Provider** | `+ @ai-sdk/openai` 等 | 大模型调用 |
| **Cards** | `+ @zhin.js/satori` | Satori 卡片组件（按需） |
| **Rich media** | `+ @zhin.js/html-renderer` | 出站 html/markdown 转 PNG |
| **Speech** | `+ @zhin.js/speech` | 入站 STT、出站 TTS、voice_stt/voice_tts 工具 |
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
| `definePlugin` | `zhin.js/plugin-runtime` |
| `defineCommand` / `defineAdapter` / `defineComponent` | `zhin.js/command` / `zhin.js/adapter` / `zhin.js/component` |
| Plugin、Message、Adapter 等 IM 运行时 API | `zhin.js` |
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
`zhin doctor --fix` 或 `zhin config check --fix` 可根据 `ai.enabled` 自动补全 `package.json`；并检查 `@zhin.js/speech` / `@zhin.js/html-renderer` optional peer。升级到 L4：`zhin doctor --upgrade-l4`。
<!-- #endregion doctor -->

<!-- #region scaffold-note -->
`npm create zhin-app` / `zhin setup` 在启用 AI 时会自动写入 `package.json` 依赖。Plugin Runtime 骨架默认只直列 `zhin.js` + 适配器；Stable Features 由 `@zhin.js/core` 的 `package.json#zhin.features` 继承（经 `zhin.js` 间接依赖亦可，见 [ADR 0053](/adr/0053-platform-stable-features)）。

仓库示例：[minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 默认 **仅 IM**（`ai.enabled: false`）；[full-bot](https://github.com/zhinjs/zhin/tree/main/examples/full-bot) 含完整 AI 栈。
<!-- #endregion scaffold-note -->

<!-- #region callout-one-liner -->
**zhin.js 4.x 安装分层**：库包 `pnpm add zhin.js`（IM 核心 &lt;10MB）；Plugin Runtime 项目再加适配器与 `@zhin.js/cli`；AI 另装 `@zhin.js/agent zod ai` 与所选 `@ai-sdk/*`。见 [ADR 0019](/adr/0019-install-size-layering)、[ADR 0053](/adr/0053-platform-stable-features) 与 [快速开始 — Install tiers](/getting-started/#install-tierszhinjs-4x)。
<!-- #endregion callout-one-liner -->
