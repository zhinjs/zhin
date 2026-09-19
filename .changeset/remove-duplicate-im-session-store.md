---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"zhin.js": minor
---

Remove the unused IM-specific session store and its Agent injection slot. The persistent and in-memory implementations now share `AgentSessionRepository` as the single origin-neutral session lifecycle contract, and generated epoch IDs no longer depend on process-global counters.
