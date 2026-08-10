---
'@zhin.js/command': patch
---

feat(command): add alias/permit/shortcut fields and Unicode command names

Commands can now declare alias (multi-word static segment replacements),
permit (builtin DSL access control), and shortcut (global exact-match with
prefilled params). Static command filenames support Unicode names
(e.g. 赞我.ts) alongside ASCII kebab-case. Permit failures result in silent
non-match for graceful degradation.
