---
"@zhin.js/console-protocol": patch
"@zhin.js/gateway": patch
"zhin.js": patch
---

Console「需要你处理」：新增只读 RPC `attention.list`（`status.view`），把待登录、离线账号、插件异常 / 依赖未满足 / 配置无效、配置文件无法读取 / 改动未生效 / 明文密钥、待审批工具调用、未连接的 MCP 服务和错误日志汇总成带深链的条目，按调用者权限逐条过滤，标题按请求的 `locale` 本地化。协议导出 `ATTENTION_RPC`、`ConsoleAttentionItem` 与稳定指纹 `attentionItemId`；网关配置存储新增 `readLiteralSecrets()`。
