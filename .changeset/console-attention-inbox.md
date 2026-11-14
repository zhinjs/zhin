---
"@zhin.js/console-protocol": patch
"@zhin.js/gateway": patch
"@zhin.js/host-http": patch
"zhin.js": patch
---

Console「需要你处理」：新增只读 RPC `attention.list`（`status.view`），把待登录、离线账号、插件异常 / 配置无效、项目插件依赖未满足（整个项目一条，不再按插件重复）、配置文件无法读取（只给出项目内相对文件名、行列与错误类别，不回显解析器原文）/ 改动未生效 / 明文密钥、待审批工具调用、未连接的 MCP 服务和错误日志汇总成带深链的条目，按调用者权限逐条过滤，标题按请求的 `locale` 本地化。账号以 `endpoint.list` 行的 `adapter` + `name` 标识（与 Console 作用域路由、账号级角色绑定一致；`endpoint.list` 的账号级过滤同步改用该键）。插件、配置、MCP 与日志的原始读取在请求间共享（并发合并，15 秒或项目文件 / 运行代变化即失效），权限过滤仍逐个调用者进行；账号与登录任务实时读取。每个来源要么完整给出，要么列入 `unavailable`。协议导出 `ATTENTION_RPC`、`ConsoleAttentionItem` 与稳定、无碰撞的条目标识 `attentionItemId`（`<kind>:<字段>=<值>…`）；网关配置存储新增 `readLiteralSecrets()`，插件管理新增 `checkDependencies()` 与 `inspect(…, { dependencies: 'skip' })`。
