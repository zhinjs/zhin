---
"@zhin.js/command": patch
"@zhin.js/core": patch
---

Use `segment-matcher` as the CommandIndex engine, add typed canonical segment parameters and
expose unmatched structured segments through CommandContext. Preserve structured command input
while stripping adapter command prefixes in the Core message dispatcher.
