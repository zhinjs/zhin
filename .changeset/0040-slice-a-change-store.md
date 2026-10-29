---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0040 slice A: self-change staging area `.zhin/changes/` — change object, forward-only state machine, `content_hash`, writable-target whitelist and forbidden config keys, `self_change` audit kind and `change_*` reason codes. Disk use is bounded (terminal states drop staged files, 14-day metadata retention, 24-hour idle expiry, 5 MB / 50 files per change, 50 MB total) with pruning at start-up and every 6 hours.
