---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Publish `todo_read` and `todo_write` as native generation-owned ToolFeatures backed by a session-addressed, crash-safe TodoStore.

The canonical session key is now the only TODO identity. Storage filenames are hashes, replacements are serialized and atomically renamed, aborted writes are never published, and model input cannot select a chat identifier or filesystem path. `.zhin/` is now runtime-private state and generic file tools cannot read or enumerate journals, TODO documents, or other authority-owned files.

BREAKING CHANGE: `todo_read` and `todo_write` no longer accept `chat_id`; TODO state is isolated by the canonical Turn session and moved to `.zhin/todos`.
