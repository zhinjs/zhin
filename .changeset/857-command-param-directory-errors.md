---
"@zhin.js/command": patch
---

Explain the parameter directory rule when a command path is invalid. Nested parameter directories such as `commands/term/[word]/[...definition]/index.ts`, or a static directory after a parameter directory, now fail with a message that states the rule (one parameter directory per command, and it must be the last directory), names the file and shows the corrected path and `params` declaration. A directory parameter that is not the first `params` entry now gets the reordered list in the error.
