---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/plugin-content-moderation": patch
---

Batch queued group moderation by conversation and sender while allowing ordinary inbound handling to continue. Preserve original-message evidence, notice-based escalation, model-owned recall and generation cancellation. Bound each group's pending buffer, explicitly audit reviews skipped at capacity, and attribute shared completions proportionally without counting the group request more than once. Older completion hosts retain per-message attribution.
