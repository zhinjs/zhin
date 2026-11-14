---
"@zhin.js/runtime": patch
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/client": patch
---

插件市场元数据不再阻止实例启动（#1250 review）：实例加载包时，`zhin.metadata.category` 不在枚举内、`descriptionI18n` 无效、`displayNameI18n` / `descriptionI18n` 含 `zh-CN` / `en` 以外的语言键，只记一条结构化警告（`manifest_metadata_dropped`，带包名与字段）并丢弃该值；`displayNameI18n` 形状错误、空字符串和未知的 `metadata` 键仍然报错。`zhin plugin check` 与发布流程保持严格校验。`parsePackageJson` 新增可选参数 `{ metadata: 'strict' | 'lenient', onWarning }`（默认 strict），`NodePackageResolver.create` / `RootRuntime` / `RootHost` 新增 `onManifestWarning`。

`zhin search` 识别文档推荐的 keywords `zhin.js`，以及 `zhinjs`、`zhin-plugin`（不区分大小写）和带 `zhin` 清单字段的搜索结果。

会话选择器：没有 `endpoint.view` 时可以手动填写适配器、账号 ID（规范 endpoint ID，`\0` 表示分隔符）与会话 ID，并提示缺少的权限；没有 Provider 的 `ConversationLabel` / `useConversationDirectory` 共享同一对进行中的请求，并按连接缓存 10 秒。声明式页面动作带 `result` 时，未设置 `result.tone` 则沿用计算出的语气（如 `passed: false` 为 danger），并在内联结果中显示返回的 `message`（结果本身已渲染 `message` 时不重复）。
