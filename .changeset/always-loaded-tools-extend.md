---
'@zhin.js/agent': patch
'@zhin.js/ai': patch
---

`deferredTools.alwaysLoadedTools` now extends the default resident tools (`ask_user`, `spawn_task`, `discover`, `load_tool`, `load_skill`) instead of replacing them, so an override no longer hides `discover`/`load_tool`. Set `deferredTools.alwaysLoadedMode: 'replace'` to restore the previous replace behaviour.
