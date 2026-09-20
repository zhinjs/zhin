---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"zhin.js": patch
---

Remove the unused IM-specific session store and its Agent injection slot. The persistent and in-memory implementations now share `AgentSessionRepository` as the single origin-neutral session lifecycle contract, and generated epoch IDs no longer depend on process-global counters.
