---
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
---

Restore legacy Sandbox streaming history updates while preserving revision precedence, creation order, recall boundaries and browser-cache provenance. Report empty QQ send plans as not sent before any platform call.

Seek past completed conversation-history backfill batches instead of re-scanning the migrated prefix. Preserve original event data, retention and compatible older writers.

Report terminal provider quota and billing failures after publication without regeneration, and isolate synchronous diagnostic failures from provider outcomes and retry/fallback decisions.
