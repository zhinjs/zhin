---
"@zhin.js/cli": patch
"@zhin.js/console-protocol": patch
---

更正上一版发布说明：认领码只由 `zhin status` 显示（或读 `.zhin/chat-owner-claim.json`），实例日志里只记它的哈希前 8 位，不会出现认领码本身。1.4.0 / 1.5.0 发布说明中「实例日志与 `zhin status` 给出一次性认领码」的写法有误（ADR 0060「安全复核」）。
