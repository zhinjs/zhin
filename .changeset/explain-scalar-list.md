---
"@zhin.js/cli": patch
"@zhin.js/console-protocol": patch
---

`config:explain` now explains a list of scalars (`{ type: 'array', items: <scalar or literal choice> }`) as a single field compared as a whole, instead of refusing the whole plugin as `complex-schema`. This keeps every plugin explainable now that the framework injects the `disabledCommands` string list next to `commandNamespace`. Arrays of objects, tuples, nested arrays, dictionaries, other unions and references are still reported as `complex-schema`.
