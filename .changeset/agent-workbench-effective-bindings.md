---
"@zhin.js/host-http": patch
"zhin.js": patch
---

Console「机器人状态」（#1250）：`/introspection/bindings` 的 `provider` / `model` 改为当前生效的用途绑定（`purposes.agents[name]`，否则默认 `chat`），不再读已废弃的 `ai.agents.*.provider/model`（之前全是 `- · -`）；行新增可选 `displayName`、`serviceId`、`profileId`、`profileLabel`、`purpose`、`bindingSource`、`configuredProvider` / `configuredModel`。新增 `/introspection/recent-turns`：trace 归档里最近 7 天的回合（新到旧，最多 20 条，只含会话名、状态、模型与 token 计数）。
