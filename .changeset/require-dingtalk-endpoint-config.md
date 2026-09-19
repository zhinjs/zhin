---
"@zhin.js/adapter-dingtalk": minor
---

Require the canonical expanded DingTalk endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity and app credentials from `process.env`. The public config type is now `DingTalkEndpointConfig`; optional webhook and robot fields are no longer incorrectly required by the schema.
