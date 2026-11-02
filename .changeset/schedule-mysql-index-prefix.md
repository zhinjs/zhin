---
"@zhin.js/cli": patch
---

MySQL schedule-history indexes no longer put a 128-character prefix on VARCHAR(64) `id` / `run_id` columns (that raised `ER_WRONG_SUB_KEY`). Keep the prefix only on unbounded TEXT `job_id`.
