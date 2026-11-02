---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/core": patch
"@zhin.js/im-contract": patch
"@zhin.js/tool": patch
---

Only replay a failed scheduled task when its actual tool calls can be proven safe to repeat. Preserve committed or unknown effects, original attempt results and canonical delivery receipts instead of retrying the whole task after an observation or notification failure.

Add generation-owned execution history for run times, attempts, basic progress, final output and separate delivery outcomes. Use the configured file or SQL backend, retain a UTC calendar month, and expose full-scope Console read and expired-history cleanup endpoints. Deleted task definitions do not delete their execution history; unfinished records are shown as unsettled or interrupted without automatic recovery.

Keep observation writes independent of business execution. Coalesce snapshots through one bounded owner, including audit and optional activity projections. At most 128 completed runs / 16 MiB of unpersisted terminal snapshots are retained, including an in-flight snapshot; oversized or overloaded records produce visible recording gaps and never replay work. Shutdown does not wait indefinitely for an unabortable observation write.

The optional internal Tool effect reporter grants no authority and does not require a plugin API floor change. Existing tools continue to work without it; undeclared effect safety is not inferred from their names or returned text. The Console execution-history UI requires the corresponding new Host endpoints; this changeset does not publish or deploy either application.
