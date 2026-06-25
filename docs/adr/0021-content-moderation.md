# ADR 0021：内容审查 — 机制在框架，策略在运营者

## 状态

Accepted

## 背景

- 仓库曾提供 **`@zhin.js/sensitive-filter`** 插件（关键词替换 / 拦截），仅挂 `before.sendMessage`，且内置大量司法辖区相关词表。
- 用户希望「内容敏感审查」能力，但需判断：是否应像 `@zhin.js/speech` 一样迁入 optional peer 并由 `zhin start` 自动注册？
- 框架已有 **`MessageFilterFeature`**（谁/哪群/哪端点）与 **Dispatcher Guardrail**、**`before.sendMessage`** 发送链 hook。

## 决策

### D1. 内容审查不属于 IM 核心 / 默认安装

- **不**写入 `@zhin.js/core`。
- **不**在 `zhin.js` bootstrap 默认路径自动注册审查逻辑（对比 speech / html-renderer：后者是「多模态格式转换」，与「内容传给 AI」产品路径一致；审查是 **运营策略**）。
- 与 [ADR 0019](./0019-install-size-layering.md) IM 核心极简原则一致。

### D2. 与 `message_filter` 分层

| 层 | 能力 | 内置 | 问的是 |
|----|------|------|--------|
| 路由过滤 | `message_filter` / Guardrail | 是 | **谁、哪群、哪平台** 的消息要处理？ |
| Agent 安全 | ExecPolicy / FilePolicy | agent 包 | **Agent 能否执行/读写** 危险资源？ |
| 内容审查 | 运营者插件 / 外部 DLP | **否** | **文本说什么** 是否合规？ |

三者正交，不合并为一个 Feature。

### D3. 框架提供的 hook（SSOT）

**入站（用户 → AI / 命令前）**

- `dispatcher.addGuardrail(middleware)` — 在 [`register-core-services.ts`](../../packages/im/zhin/src/setup/register-core-services.ts) 中与 `MessageFilterFeature` 同阶段；审查 Guardrail 应注册在路由 filter **之后**。
- 可 block（不调用 `next()`）、或改写 `message.$content` 后再 `next()`。

**出站（Bot → 平台）**

- `before.sendMessage` — 在 [`Adapter.renderSendMessage`](../../packages/im/core/src/adapter.ts) 中，于 `resolveRichSegments` **之后**执行；适合 replace / block 出站文本。

集成指南：[内容审查 hook](/advanced/content-moderation)。

### D4. 运营者责任

- 词库、云 API、误判与法律责任由 **Bot 运营者** 承担；框架不提供法律保证。
- 日志：建议只记 `messageId`、方向、命中类别/count，**不持久化命中词原文**。
- 国内 IM 须同时遵守 **平台侧审核**（如 QQ `MESSAGE_AUDIT` intent）；模型 Provider 的 `content_filter` 可作为补充，不替代平台规则。

### D5. 移除 `@zhin.js/sensitive-filter`

- 从 monorepo **删除** `plugins/utils/sensitive-filter`（内置词表不应由官方仓库 ship）。
- npm 包 major 移除；迁移路径见文档 hook 指南。
- **v1 不** 新建 `@zhin.js/content-moderation` first-party 包。

### D6. 未来 optional 包（非 v1，需复审）

若出现明确产品需求，可另开 ADR：

- 包仅提供 engine + provider 接口；**零内置词表**。
- **不**写入 `bootstrapNode` 默认路径；须 `moderation.enabled` + 显式注册或独立插件。

## 后果

- 需要内容审查的用户：自研插件或第三方，挂 Guardrail + `before.sendMessage`。
- test-bot 等示例不再依赖 sensitive-filter。
- 文档与 ADR 成为 SSOT，避免「框架默认帮用户审内容」的错误预期。

## 相关

- [ADR 0019](./0019-install-size-layering.md)
- [ADR 0020](./0020-speech-pipeline-stt-tts.md)
- [消息过滤](/essentials/message-filter)
- [内容审查 hook 指南](/advanced/content-moderation)
