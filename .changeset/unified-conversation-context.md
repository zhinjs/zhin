---
"@zhin.js/im-contract": patch
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-icqq": patch
---

Replace text-only IM context and metadata-based quote handling with canonical
conversation events, scoped reference resolution, explicit Endpoint content
ports, and typed multimedia outcomes. Conversation notices are projected as
untrusted context data rather than model-authority system instructions.
The process-global passive-group buffer is removed: prior inbound conversation messages
are now consumed from the same event store and cursor, with the current Turn
message excluded from its own context projection.
The unused `ConversationMemory` topic-memory runtime, its timers, legacy tables,
and topic-window configuration are removed; `ContextRepository` is the only
Agent conversation-history authority.
