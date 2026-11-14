---
"@zhin.js/adapter": minor
"@zhin.js/core": minor
"@zhin.js/console-protocol": minor
"zhin.js": minor
"@zhin.js/host-http": patch
---

`zhin.config.yml` 的 `<适配器>.endpoints` 与已保存账号不一致时给出提示并可显式处理（#1250）。`endpoints` 只在还没有账号快照时作为首次种子，之后以数据库中的加密账号文档为准；此前在 yml 里增删账号既不生效也没有提示。

- 启动与配置重载时比对 yml 与已保存账号（按账号 id；字段比较不解析 `${VAR}`，引用只与同一引用相等，只输出路径不输出值），有差异时记一条 `endpoint_config_drift` 警告，并进入 Console「需要你处理」（新条目类型 `endpoint.config-drift`，需该适配器实例的 `endpoint.view`）。
- 新增适配器账号 RPC：`plugin.<实例>.endpoint-drift`（只读，`endpoint.view`）、`endpoint-import { id, expectedGeneration?, expectedRevision?, start? }`（把 yml 账号写入已保存账号，`${VAR}` 保存为引用、启动时才解析）、`endpoint-writeback { ids }`（把已保存账号写回 yml，密钥只写成 `${VAR}` 引用或占位引用，绝不写明文）。两者都需要 `endpoint.manage` 并进入审计；`endpoint-writeback` 会改写 `zhin.config.yml`，因此**还需要全局的 `ops.config.write`**（与其他配置写入相同），只有适配器级 `endpoint.manage` 的账号运维者会被拒绝（403）。
- 新增 `Adapter.configDrift()` / `importConfigured()` / `writeBackConfigured()`、`endpointConfigSourceToken` 与 `EndpointConfigSource` 等比对工具；实例提供配置文件端口与 `${VAR}` 账号引用解析器（`endpointSecretResolverToken`）。
- 账号启动失败原因：`startFailure` 新增 `category`（auth / network / timeout / config / process_exit / unknown）与只由类别和错误码组成的 `message`；core Endpoint 列表与 Console `endpoint.list` / `endpoint.info` 新增 `lastError { category, message, at }`（与 MCP 失败形状一致）。`endpoint_start_failed` 警告日志带类别和脱敏后的原因（屏蔽该账号凭据、URL 凭据与查询串、类令牌片段），启动摘要里因失败离线的账号以 warn 写出原因。
- 权限：`@zhin.js/console-protocol` 的 `ConsoleRpcPermissionRule`（`exact`）新增可选 `alsoRequires`（还需全局持有的权限）与 `grantsAllowAlsoRequired()`；`endpoint-writeback` 的规则带 `alsoRequires: ['ops.config.write']`，实例插件 RPC 分发与 `@zhin.js/host-http` 的 `pluginRpcWriteAllowed()` 都会检查。
- Console「需要你处理」：启动失败（`failed`）或等待重试（`retrying`）的账号也列为 `endpoint.offline`，详情附上分类后的失败原因。
