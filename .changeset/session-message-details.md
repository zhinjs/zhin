---
"@zhin.js/host-http": patch
"@zhin.js/agent": patch
---

Read complete retained user-message text on demand through the existing session-tree runtime and `GET /api/agent/sessions/:key/message`. Bind each read to the tree's session ID, reject cross-session/non-user messages, and return text without image payloads. Keep tree previews unchanged and report older runtimes without message reading as unsupported.
