---
"@zhin.js/host-http": minor
"@zhin.js/console-protocol": minor
"@zhin.js/cli": minor
"@zhin.js/runtime": minor
"@zhin.js/database": patch
"@zhin.js/mcp": patch
"@zhin.js/a2a": patch
"@zhin.js/agent": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-bilibili": patch
"@zhin.js/adapter-bilibili-live": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/plugin-rss": patch
---

Console 访问控制（ADR 0049）：用户、角色、会话、API 令牌与审计日志存入项目数据库，每个 Console RPC、`/api` 路由与 Host 鉴权的 WebSocket 都按 `@zhin.js/console-protocol` 的权限表放行，未登记的一律拒绝。

**破坏性变更**

- `http.tokens` 与演示模式（`scope: demo` / `user`）删除；配置里仍有 `http.tokens` 时 Host 拒绝启动。Host 配置 Schema 同步删除该字段。
- `http.token` 变为初始化令牌：只在创建第一个所有者之前有效，之后在所有接口上被拒绝。
- 未在 `CONSOLE_WS_PERMISSIONS` 登记、又使用 Host 鉴权的插件 WebSocket 不再接受 Console 账号；插件自己的 WebSocket 应改用 `ws(path, { auth: 'protocol' })` 并自行校验凭据（新增 `verifyProtocolAccessToken`、`isLoopbackAddress`）。
- OneBot 11 / 12、NapCat、Milky 的反向 WebSocket 改为只认适配器自己的 `access_token`；未配置 `access_token` 时只接受本机回环连接。
- `zhin doctor --live` 等改从 `ZHIN_CONSOLE_TOKEN` 读取 API 令牌（仍兼容 `ZHIN_HTTP_TOKEN`）。

**迁移步骤**（详见文档「升级到 Console 访问控制」）

1. 升级后用 `http.token` 打开 Console 初始化向导创建第一个所有者，或运行 `zhin console init`（脚本：`zhin console init --yes --owner <名> --password-stdin`）。
2. 删除配置里的 `http.tokens`，在 Console「访问控制」里为原来的令牌持有人创建用户并绑定角色（`viewer` / `operator` / `admin`）；演示环境改用 `viewer` 账号。
3. 自动化在 Console 签发 API 令牌，放进 `ZHIN_CONSOLE_TOKEN`。
4. 从其他机器或容器连接的反向 WebSocket endpoint 补上 `access_token`。
5. 忘记密码或所有者被锁时，停下 Host，用 `zhin console user passwd|enable|create` 离线恢复。

MCP / A2A 的 Bearer 访问同样接受用户 API 令牌（分别需要 `mcp.access`、`a2a.access`）。适配器与插件文档同步改为账号与角色的说法。
