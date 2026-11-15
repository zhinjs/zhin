---
"@zhin.js/kernel": patch
---

#1250 第 26 批：`redactSecretText` 补充脱敏 JSON 字段（`"token":"…"`、`"api_key": "…"`）、YAML / 文本字段（`api_key: …`、`password: '…'`，纯数字值如 `max_tokens: 100` 不受影响）、URL 查询参数 `?key=…` / `&key=…`，以及 Telegram Bot API 路径 `/bot<id>:<token>/`。
