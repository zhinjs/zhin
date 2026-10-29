---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0041 §6: two-level cache for group info and member profiles. Level 1 stays the in-memory 60 s cache; level 2 is the database. Facts are read L1 → L2 → platform and every platform result (and every side event) is written to both levels; the bot's own role is still read fresh each turn and only written through. A level-2 row older than 24 h is served and refreshed once in the background (de-duplicated, bounded concurrency, cancelled with the generation). Group facts extend `ai_session_profiles` with `owner_id`, `member_count` and `facts_updated_at` (additive migration); member facts live in the new `ai_scene_members` table. Storage is bounded: a member row is deleted on leave or kick, rows untouched for 90 days are pruned, each scene keeps at most 2000 rows (oldest `updated_at` evicted), pruning runs at startup and every 6 hours, and stored text is cleaned and capped at 128 characters.
