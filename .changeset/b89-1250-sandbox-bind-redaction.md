---
"@zhin.js/kernel": patch
"@zhin.js/core": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/console-protocol": patch
"@zhin.js/adapter-sandbox": patch
---

fix(1250): 共享 Sandbox 不再泄露绑定码；`attention.list` 下发 `state.simulationOnly`（第 89 批）

- sandbox-transcript-shared-bind-code：新增 `redactChatIdentityBindText` / `isChatIdentityBindText`（`@zhin.js/kernel`，经 `@zhin.js/core` / `zhin.js` 导出），按形态（「绑定 / bind」后只有一个形如绑定码的参数：8 位绑定码字母表，至多用空白或 `-` 拆成两段，没有数字时须是一个全大写的词；带不带命令前缀）把绑定消息改成 `绑定 ***`，不看码是否仍有效；`bind username`、`BIND ME PLEASE` 等照常保留，形如绑定码的参数（如 `绑定 23456789`）在 Sandbox 中也会被改写。Sandbox 端点在回显、广播、日志、`platform.receive` 与交给 Runtime 之前就脱敏，发送者气泡由回显替换为脱敏文本；Core 会话记录、`receive` / `dispatch_miss` 日志、Agent 会话消息与 trace 写入时按形态兜底；会话历史接口回放时再脱敏一次，覆盖已落盘的旧记录。认领码行为不变。
- `chat-roles.no-owner` 的「需要你处理」条目下发 `state: { simulationOnly }`（`ConsoleAttentionItem.state` / `ConsoleAttentionItemState`，可选字段），供 Console 显示「打开 Sandbox」（客户端后续接入，目前尚无消费方）；revision 计算不变。
- ADR 0060 与中英文文档记录后续项「沙盒会话按 Console 用户隔离」。
