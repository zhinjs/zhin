---
"@zhin.js/runtime": patch
"@zhin.js/pagemanager": patch
---

Track each loaded Feature entry's transitive local imports so edits to imported helper files reload only the affected capabilities, including helpers outside the entry directory, while refreshing the complete ESM import closure.
