---
"@zhin.js/testing": patch
---

新增 `runTool` / `createToolContext` / `toolOriginFromMessage`，可以在单元测试里运行 Agent 工具。执行方式与运行时的工具索引一致：可执行 `inputSchema` 先解析输入，绑定 `adapter` 的工具必须传匹配的 `client`。传 `message` 时，`origin` 和 `principal` 从假消息推导。

**行为变化**：插件声明了 `config` schema 时，`runPluginSetup` 现在会像运行时一样校验 `config`、填充默认值，并且只保留 schema 顶层声明的字段。不合法时抛出 `PluginConfigValidationError`。新增 `resolvePluginConfig(definition, input)`。

迁移：如果某个测试故意传了不合法或不完整的配置，先补齐配置；或者给这个测试加上 `runPluginSetup(plugin, { config, validateConfig: false })`，恢复原来"原样传入"的行为。没有声明 `config` 的插件，以及 `createFakePlugin` / `fake.setup()`，都不受影响。

Added `runTool` / `createToolContext` / `toolOriginFromMessage` for unit-testing Agent tools. Behaviour change: when the plugin declares a `config` schema, `runPluginSetup` now validates and defaults `config` like the Runtime does (throws `PluginConfigValidationError`). To keep the old verbatim behaviour, pass `validateConfig: false`.
