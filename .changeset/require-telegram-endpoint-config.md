---
"@zhin.js/adapter-telegram": patch
---

Require the canonical expanded Telegram endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity, token, and webhook secret from `process.env`. The public config type is now `TelegramEndpointConfig`.
