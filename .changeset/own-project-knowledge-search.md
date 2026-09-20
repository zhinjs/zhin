---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"zhin.js": patch
---

Replace the detached class-based `knowledge_search` implementation with a generation-owned Tool Feature backed by the explicit `KnowledgeIndex` contract and encapsulated `MarkdownKnowledgeIndex`. The CLI publishes it to main and subagent turns only when `ai.knowledge.baseDir` is explicitly configured inside the project root. Knowledge indexing is bounded, abort-aware, deterministic, and shared by both execution paths.
