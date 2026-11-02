---
"@zhin.js/agent": patch
---

Consolidate prompt rules at the existing assembly seams: explicit authority and evidence boundaries,
task-appropriate reply detail, conditional tool use, and memory as context rather than permission.
Preserve the distinct delegated, scheduled, recovery and auxiliary-model contracts. Apply existing
bootstrap scene scoping to scheduled requests using their actual turn context.

Keep runtime permissions, approval, provider-cache mechanisms and retry configuration unchanged.
Whole-job scheduled replay safety is documented separately and is not resolved by prompt wording.
No existing workspace prompt files are automatically rewritten.
