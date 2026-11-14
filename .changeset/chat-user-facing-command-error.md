---
"@zhin.js/command": minor
"@zhin.js/core": minor
"@zhin.js/game-kit": patch
---

指令执行中抛出的「面向用户」的拒绝不再被静默吞掉（#1250）：`@zhin.js/command` 新增 `UserFacingError`（及 `isUserFacingError` / `userFacingErrorText`，经 `zhin.js/command` 导出），指令分发把它转成该指令的回复，经正常出站链（`$reply`）发出，按发送者语言调用 `format(locale)`；其他错误照旧抛给入站运行时记录日志，不把错误信息或堆栈回给用户。`GameSessionConflictError` 改为继承 `UserFacingError`，群里已有一局「guess」时发「rps 开始」会收到「你在当前频道已有进行中的「guess」对局…」，不再只在适配器日志里出现 `sandbox_gateway_receive_failed`。
