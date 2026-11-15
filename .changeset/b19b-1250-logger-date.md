---
"@zhin.js/logger": minor
---

日志时间戳带日期（zhinjs/zhin#1250 第 19b 批）：`DefaultFormatter` 在 stdout 不是终端时（文件、管道、网关托管的实例日志 `.zhin/logs/instance.log`）写 `[2026-11-15 16:22:15.448]`，终端里仍是 `[16:22:15.448]`；新增第二个构造参数 `{ date?: boolean }` 固定其中一种（`DefaultFormatterOptions`）。新增 `parseLogLine(line)`（与类型 `ParsedLogLine`）：按同一格式解析一行，日期可有可无、先去掉颜色，供 `zhin logs` 过滤和 Console 系统日志使用。README 写明消息字段统一用 `formatCompact()` 的 `动作 | 键: 值 | 标记`。
