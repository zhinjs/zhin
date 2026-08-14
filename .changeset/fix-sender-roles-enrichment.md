---
'@zhin.js/core': patch
'@zhin.js/cli': patch
---

fix(core): 入站 Message 的 sender.roles 携带 master/trusted 框架角色

ImRuntime 新增 `enrichSender` 选项，在构造 Message 前由组合根（start-command）注入，
从 config 的 `ai.trigger.masters`/`ai.trigger.trusted` 及 endpoint 级 master/trusted 判定后
将框架角色合并进 `sender.roles`。整个下游链路（命令分发、agent ingress）均可直接读取。
