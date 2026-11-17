---
"@zhin.js/adapter-email": patch
---

email 入站附件改为每封邮件存进 `attachments.downloadPath` 下独立的 `mail-*` 子目录，并以不覆盖方式写入（#1250 第 44 批）：两封邮件带同名附件时不再互相覆盖，Agent 读到的始终是本封邮件的附件。
