---
"@zhin.js/adapter": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/core": patch
"@zhin.js/im-contract": patch
"@zhin.js/middleware": patch
"@zhin.js/plugin-runtime": patch
---

Preserve confirmed progressive reply content, routing and delivery evidence across cancellation, rollover and closing failures without replaying published text. Keep error dispositions and actual message references, and abort the owning provider request when its functional text consumer fails.

Enable native Sandbox Markdown through the real Core projection so Console updates retain formatting in one message. Preserve instance-level streaming opt-outs, recall tombstones and multi-page synchronization, including legacy event-history updates across pages. The first safe content is immediate; later updates retain the configured pacing, including large valid intervals.

Keep Slack and Lark Markdown streaming within the current physical message. When continuation formatting cannot be verified, stop and retain confirmed content instead of replaying or silently changing it to plain text. Plain-text continuations retain their original reply route.

Use rebuildable revision metadata and indexes in the existing conversation event table for bounded SQL history reads, and seek past completed backfill batches during upgrades. Original event JSON and retention remain unchanged; older writers and models keep their compatible read path. Supported adapter streaming remains enabled by default, with complete-message fallback for disabled settings or outbound middleware without incremental: true. Empty QQ payloads report not sent, and provider diagnostic failures cannot replace delivery or quota outcomes.
