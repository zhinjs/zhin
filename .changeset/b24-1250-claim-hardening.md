---
"@zhin.js/kernel": patch
"@zhin.js/core": patch
"zhin.js": patch
---

认领码入站保护加固（ADR 0060 §3.3，zhinjs/zhin#1250 第 24 批，#1289 复审建议）：

- 自己账号发出的带码消息（`origin === 'self'`，自回声）被丢弃时也作废认领码，与会话未就绪、其他机器人、成员账号、去重失败几条丢弃分支一致。
- 写入端兜底登记表改为挂在 `globalThis` 的 `Symbol.for('zhin.kernel.chat-owner-claim-codes')` 上：项目里装了两份 `@zhin.js/kernel` 时，一份登记的码另一份也能脱敏。
- `redactChatOwnerClaimText()` 只替换命中的那一段：只有 NFKC 形式命中时（全角码）不再把整条文本换成 NFKC 形式，其它字符保持原样。
- 码比较时忽略的字符扩为空白、`-`、格式字符 `\p{Cf}`（U+2061–2064、U+200E/200F、U+180E 等）与组合符号 `\p{M}`（U+034F、U+FE0F 等）；认领的精确比较使用同一口径（新增 `foldChatOwnerClaimText()`），码中间夹着可见标点（`ABCD.2345`）时两边都不认作该码，能授予的文本一定会被识别为含码。
- 原生事件检查扩大到 `message.receive` 以外的所有 Endpoint 事件（`platform.receive` 及其它原生侧边事件、通知、请求附言、系统事件），含码则不记录、不派发。检查不再截断：读遍字符串、数字、字节缓冲（按 UTF-8）、数组、对象、Map 与 Set，超出预算（深度 32、5 万个值、400 万字符）、读取抛错或字节缓冲（含 `SharedArrayBuffer` 及其视图）无法解码时按含码处理（fail-closed），并按事件名限频记 warn（同一事件名 10 分钟至多一条，不带载荷内容）。被扣下的通知、请求、系统事件确实含码时还会作废码（新增 `InboundSecretGuard.discardNative`）：平台上其他人（如看入群附言的管理员）已经看到；`platform.receive` 只扣下不作废。每个字符串只折叠一次，仅非 ASCII 时做 NFKC（新增 `createChatOwnerClaimCodeScanner()`）。
