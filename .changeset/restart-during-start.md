---
'@zhin.js/cli': patch
---

Fix a startup race (#742): a Console restart or a signal that arrives after HTTP is listening but before the first generation finishes starting no longer crashes the process with an unhandled `Root lifecycle is stopping` error (exit code 1). The aborted start is now treated as part of the requested shutdown, so the process exits with the restart code (75) or the signal code as intended.
