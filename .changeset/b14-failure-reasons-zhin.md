---
"zhin.js": patch
"@zhin.js/ai": patch
---

失败原因看得见（#1270 第 14 批）：实例把账号准备、模型调用、账号启动与 MCP 连接的最近一次失败原子写入 `.zhin/runtime-failures.json`，成功后清除，重启后标为「重启前记录」；「需要你处理」新增模型账号（需重新登录 / 已断开 / 结果未知 / 准备失败）与无效配置（子 Agent 的模型选择被忽略）条目，MCP 未连接条目给出原因；实例启动中 `attention.list` 返回「启动中」，不再逐个来源记 WARN。模型服务接口的失败都带 `details` 与 `nextStep`；Antigravity 开通被上游拒绝（`UNSUPPORTED_CLIENT`）时保留这一原因并提示填写 `projectId`。
