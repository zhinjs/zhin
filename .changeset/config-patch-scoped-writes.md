---
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/client": patch
"@zhin.js/cli": patch
"@zhin.js/service-typesafe": patch
---

新增 Console RPC `config:patch`：按路径写入配置，供面向普通用户的简单页面使用（#970）。

- 路径白名单：带 `instanceKey` 时只能写该插件实例自己的配置块，以及插件 `schema.json` 根部 `x-zhin-config.patchPaths` 声明的 Host 子路径；省略时只能写 `HOST_CONFIG_PATCH_PATHS`（目前为 `ai.trigger.ambient`）。
- `expectedRevision` 必填；文件已变时返回 `status: 'conflict'` 和最新值，不覆盖。
- 写入前按 schema 校验每个被改动的配置块；成功响应带 `restartRequired`，`config:updated` 事件新增 `paths` 与 `revision` 字段。
- `@zhin.js/client` 新增 `patchConfig()`；`@zhin.js/service-typesafe` 声明可写 `ai.decisions`。

纯新增能力：`config:set`、`config:replace-source` 与 YAML 编辑器行为不变，无需迁移。`config:patch` 只接受 full scope Token，Demo 部署不可用。
