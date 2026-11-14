---
"@zhin.js/adapter": minor
"@zhin.js/console-protocol": minor
"zhin.js": minor
"@zhin.js/adapter-bilibili-live": patch
---

#1250 账号导入 / 写回与插件 Console RPC 权限的评审修复：

- 权限：插件 Console RPC 的方法名只有一种规范化（新增导出 `normalizePluginConsoleRpcType()`）：camelCase 与 `action.` 写法（如 `plugin.root/qq.action.endpointWriteback`）按 kebab 方法（`endpoint-writeback`）解析权限目标、`alsoRequires`（`ops.config.write`）与写操作分类（进入审计），实例分发与审计 action 也使用规范类型。此前这类写法会落到通用插件规则，绕过 `ops.config.write` 与审计。
- 写回：yml 里已有的 `${VAR}` 引用（条目自己的或从实例块继承的）只有在进程内解析后等于已保存值时才保留；不同或无法解析时写成新的占位引用，`placeholders[].reason` 为 `reference_mismatch` / `reference_unresolved`。新增可选端口 `EndpointConfigSource.resolveReference`。凭据也按值识别：URL 用户信息、带凭据的查询参数写成占位引用，含凭据的列表拒绝写回。写回结果新增 `reconnectsAll: true`，提示该适配器实例的全部账号会随配置重载重新连接；写回会重新生成整个 `endpoints` 序列（列表内注释丢失）。漂移比对同样在进程内比较引用与已保存值。
- 导入：yml 账号的身份字段与已保存账号不同时拒绝导入（请替换账号）；导入的配置经过 `prepareConfiguration` / `validateConfiguration`；`endpoint-import` 必须带 `expectedRevision`；导入尚未保存的账号需要适配器级 `endpoint.manage`。
- 启动：创建 Endpoint 时抛出的 `TypeError` 若是网络失败（undici `fetch failed`、cause 带网络错误码）按网络错误重试；`Adapter.configurationCredentialFields`（默认等于身份探测字段）的值在失败原因中脱敏，Bilibili 直播声明 `sessdata` / `biliJct` / `buvid3`。
- `zhin start --once`：等待首次启动尝试有结果（最多 30 秒），有账号 `failed` / `retrying` 时以非零码退出并列出失败账号。
