---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Semantic memory retrieval uses BM25 (#734). `memory_search` ranks with BM25 (word tokens plus CJK bigrams), and each turn now recalls the top-k entries relevant to the current message from the initiator's visible scopes into the turn context, bounded by `ai.memory.semantic.recall` (`topK` 5, `maxTokens` 400 by default), so memory cost per turn no longer grows with the number of entries. Users can view and forget memory about themselves with `/memory` and `/forget`; `SemanticMemoryRuntime` gains `list` / `delete` for management surfaces.
