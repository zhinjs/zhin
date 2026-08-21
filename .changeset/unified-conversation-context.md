---
"@zhin.js/im-contract": major
"@zhin.js/adapter": major
"@zhin.js/core": major
"@zhin.js/agent": major
"@zhin.js/ai": major
"@zhin.js/cli": minor
"@zhin.js/adapter-icqq": minor
---

Replace text-only IM context and metadata-based quote handling with canonical
conversation events, scoped reference resolution, explicit Endpoint content
ports, and typed multimedia outcomes. Conversation notices are projected as
untrusted context data rather than model-authority system instructions.
The process-global passive-group buffer is removed: prior inbound conversation messages
are now consumed from the same event store and cursor, with the current Turn
message excluded from its own context projection.
