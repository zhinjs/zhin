---
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/gateway": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/adapter": patch
"zhin.js": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-short-url": patch
---

插件权限按级别授予内置角色，插件 Console RPC 按方法鉴权（ADR 0049 修订）

- console-protocol：插件权限（`<plugin>:<action>`）分为 read / operate / manage 三级，可在 `definePluginConsoleRpc({ permissions })` 声明，未声明时按后缀推断；新增目录权限 `plugin.perms.read|operate|manage`：viewer 得到 read，operator 得到 read + operate，admin 与 owner 得到全部。
- gateway / host-http：自定义角色与 API 令牌可以写入插件权限；`iam.roles.list` 返回各角色实际生效的插件权限与当前运行时的插件权限目录（`pluginPermissions`）；`/auth/me` 按已加载插件展开级别授予。
- zhin.js：已登录用户与 API 令牌调用 `plugin.<id>.<method>` 时，按方法自身、所属页面或目录兜底权限逐一检查（此前只检查 `feature.view` / `feature.configure`，operator 可以审批 `ops:approve` 操作）；门禁放行但无插件分发器应答的请求一律拒绝并记审计。
- adapter：账号类方法的授权目标与处理函数选择账号的方式一致（`consoleAccountTarget`，先看 `data.instanceId`），`id` / `instanceId` 不一致或放在 `data` 之外时拒绝，避免按一个账号授权、却操作另一个账号；适配器 / 账号作用域的绑定可满足目录与插件权限。
- plugin-runtime：`definePluginConsoleRpc` 支持声明权限级别。
- rss / reminder / ledger / calendar / qrcode / short-url：补充权限级别声明（写操作为 operate 级）。
