---
"@zhin.js/cli": patch
"@zhin.js/console-protocol": patch
---

`config:explain` now explains fixed string-literal choice fields (the `anyOf` of string `const`s the Console form edits as options) as string scalars, instead of refusing the whole plugin as `complex-schema`. Other unions, arrays, dictionaries and references are still reported as `complex-schema`.

The `@zhin.js/console-protocol` README documents that literal-choice fields are explainable.
