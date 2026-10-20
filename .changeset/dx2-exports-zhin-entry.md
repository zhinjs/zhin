---
"@zhin.js/runtime": patch
---

Recognise `package.json#exports["./zhin"]` (conditions `zhin` → `import` → `default`) as the runtime entry when `zhin.entry` is omitted. `zhin.entry` stays fully supported and wins when both are declared.
