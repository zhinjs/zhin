---
'@zhin.js/agent': patch
---

Fail closed when a required tool execution fact cannot be written to the Turn
Journal. Journal integrity failures now abort the model loop and return the
stable `turn_journal_commit_failed` outcome instead of becoming tool output.
