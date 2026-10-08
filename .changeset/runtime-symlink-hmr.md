---
"@zhin.js/runtime": patch
---

Normalize source ownership, module dependencies and reload notifications to physical paths so projects opened through symlinks reload correctly. Preserve matching after files or capability directories are removed by resolving the nearest existing parent.
