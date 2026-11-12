---
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
---

发版收尾：功能与文档对齐网关、访问控制的新语义。

- `zhin migrate` 与 `zhin runtime migrate` 的 cutover 把项目的 `zhin.js`、`@zhin.js/cli`、`@zhin.js/gateway` 同批放进 `dependencies`：只写在 `devDependencies` 的连同版本挪过去，重复项删除；缺少网关时补上（CLI 用 `latest` 等标签时沿用同一标签，否则用与当前 CLI 同批发布的版本范围）。插件包（无项目配置 / 公开发布包）的 CLI 仍是开发依赖。
- `zhin console init` 新增 `--database-password-stdin`（标准输入第一行；与 `--password-stdin` 同用时第二行是所有者密码），三种数据库密码来源只能选一个；`--database-password <值>` 保留但帮助与文档标为不推荐，使用时打印警告。
- 脚手架生成的 `.env` / `.env.example` 把 `HTTP_TOKEN` 注释改为「初始化令牌：仅在创建首个所有者之前有效」，自动化改用账号签发的 API 令牌。
- 文档：插件安装、更新、卸载统一写为网关 `gateway.packages.*`（实例内的 `plugin:install | update | uninstall` 已删除）；MCP / A2A 鉴权改为 `mcp.token` / `a2a.token`，或全局持有 `mcp.access` / `a2a.access` 的账号签发的 API 令牌，`http.token` 不再作为协议凭据（中英）；示例 `full-bot` 改用 `MCP_TOKEN` / `A2A_TOKEN`，各示例把 CLI 与网关放进 `dependencies`。
