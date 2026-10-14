---
"@zhin.js/workroom": patch
"@zhin.js/cli": patch
---

删除 legacy 迁移代码：移除 `zhin agent legacy-runs` / `legacy-payloads` 子命令，以及 `@zhin.js/workroom` 导出的 `scanLegacyEmbeddedPayloads`、`buildLegacyRunOfflineReport`、`createLegacyRunMigrationProposal` 及相关类型。旧格式 Journal 在读取和激活时仍然 fail-closed，报错信息改为说明旧格式不再受支持。
