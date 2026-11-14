---
"@zhin.js/logger": patch
"@zhin.js/adapter-icqq": patch
---

日志里的聊天内容不再能伪造日志行、群聊全文默认不落盘（#1250）：

- `@zhin.js/logger`：新增 `escapeLogText()`（换行写成 `⏎`，ANSI 等控制字符转义为 `\uXXXX`，保留制表符）与 `LOG_CONTENT_MAX_LENGTH`（300）。记录消息内容用的 `truncatePreview()` 现在总是转义成单行，未指定长度时截断到 300 字（原先不截断）。
- ICQQ 适配器：SDK 自己的 log4js 输出改由适配器转写到 Zhin 日志（同一格式，输出不是终端时没有 ANSI 颜色），继续脱敏验证链接和手机号。新增配置项 `logLevel`（`trace`…`mark` / `off`，默认 `warn`，原先写死 `info`），SDK 逐条打印的收发消息原文（`recv from: …`、`succeed to send: …`）一律按 `debug` 处理，默认不写入日志；打开时转义成单行并截断。
