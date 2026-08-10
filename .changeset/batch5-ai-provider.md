---
'@zhin.js/ai': patch
---

refactor(ai): simplify AIProvider interface to completeText

Remove chat() and chatStream() from AIProvider interface along with
ChatCompletionChunk and ChatCompletionChunkChoice types. Add completeText()
for lightweight text completion (system + user -> assistant text) used by
compaction, topic analysis, and summarization. SdkProviderAdapter now
implements completeText via ai-sdk transport. conversation-memory and
context-manager updated to use completeText.
