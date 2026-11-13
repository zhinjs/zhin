---
"zhin.js": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/console-protocol": patch
"@zhin.js/gateway": patch
---

功能覆盖迁入数据库（ADR 0057 §2）：

- 适配器 / 账号 / 会话三级功能覆盖统一存在项目数据库表 `feature_overrides`（`level` 列为 `adapter` / `endpoint` / `conversation`，主键由 `(plugin, level, key)` 生成）；旧表 `feature_conversation_overrides` 的行首次加载时复制过来，旧表保留只读。全局默认值仍是配置文件里的插件块，全局开关仍是 `disable_plugins`。
- `configFor` / `isEnabledFor`、分发门禁与 Console `feature.*` 从数据库读取适配器 / 账号级覆盖，合并顺序与锁定规则不变；Console 与聊天「功能 设置 / 开启 / 关闭」的适配器 / 账号级写入改写数据库，立即生效、不再改写配置文件。新增 `readStoredFeatureOverrides`、`validateStoredFeatureOverride`。
- 首次启动自动迁移：把配置文件里各插件块的 `overrides` 导入数据库，成功后备份原文件到 `.zhin/backups/` 并原子删除这些块，记录写入 `.zhin/migrations/feature-overrides.json`；失败时配置文件不变、下次启动重试。迁移完成后配置文件再出现 `overrides` 会在启动与配置更新时被拒绝。
- MongoDB / Redis / memory 方言下拒绝覆盖写入（503 `feature-overrides-unpersisted`），会话级也不再只存内存。
- `feature.*` 请求与响应形状不变；适配器 / 账号级的 `revision` 改为数据库行的修订号，仍兼容旧版 Console 传入的当前配置修订号。
