---
"@zhin.js/cli": patch
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
---

新增可信项目配置补丁 `config:patch-project`（仅 full 权限，Demo 写入黑名单）：与 `config:patch` 共用单次修订 CAS、整份候选校验与按组生效链，跨分组一次提交；页面 `config:patch` 与 `HOST_CONFIG_PATCH_PATHS` 白名单保持不变。项目补丁拒绝写入 `configVersion` / `plugins` / `disable_plugins` / 根插件 `plugin` 及未声明实例（结构化 `invalid`），冲突回显中的秘密、writeOnly、`${…}` 引用与疑似凭据键一律遮蔽；提交确认丢失返回结构化 `unconfirmed`，不重试、不回滚。
