---
'zhin.js': patch
---

Delete the classic Node bootstrap and its entire unreachable setup graph. `zhin.js/node`, `bootstrapNode`, classic endpoint/config/service assembly, legacy signal handling, and the duplicate database log transport are no longer published or compiled.

BREAKING CHANGE: applications must start through `zhin runtime start`; there is no compatibility stub or classic Host bootstrap subpath.
