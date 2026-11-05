---
"@zhin.js/harness": patch
"@zhin.js/agent-feature": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/a2a": patch
"@zhin.js/console-protocol": patch
"@zhin.js/client": patch
"@zhin.js/cli": patch
---

Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.
