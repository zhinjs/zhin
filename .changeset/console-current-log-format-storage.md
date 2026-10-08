---
"@zhin.js/cli": patch
---

Store the current DefaultFormatter output in Console's SystemLog transport instead of silently dropping it. Preserve the previous formatter syntax and ANSI stripping while accepting current level/category lines and multiline messages.
