---
"@zhin.js/adapter-slack": patch
---

Require the canonical expanded Slack endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity and credentials from `process.env`. The public config type is now `SlackEndpointConfig`, with mode-specific credential validation.
