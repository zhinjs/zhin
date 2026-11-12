---
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/client": patch
"@zhin.js/console-contract": patch
"@zhin.js/pagemanager": patch
"@zhin.js/a2a": patch
"@zhin.js/agent": patch
---

修复依赖安全告警：传递依赖 zod 升到 4.6.7 以上、@hono/node-server 升到 2.1.7 以上、qs 升到 6.16.1 以上（经 MCP SDK 引入），rimraf 升到 6.1.4（随之使用已修复的 glob），开发工具链的 minimatch 升到 11.x；新建插件模板的 rimraf 范围同步更新。
