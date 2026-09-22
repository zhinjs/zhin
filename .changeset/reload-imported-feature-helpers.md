---
"@zhin.js/runtime": patch
"@zhin.js/pagemanager": patch
---

Track each loaded Feature entry's transitive local imports so edits to imported helper files reload only the affected capabilities, including helpers outside the entry directory, while refreshing the complete ESM import closure. Cache clean dependency graphs, resolve package imports with ESM conditions, handle `.mts` and `.cts` entries consistently, keep CommonJS require closures on the process-restart boundary, and discard removed-entry mappings only after a generation commits.
