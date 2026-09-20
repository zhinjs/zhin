---
'@zhin.js/permission': patch
'@zhin.js/core': patch
---

Replace the permission host factory with an explicitly owned `PermissionHost` class. Each IM runtime now holds a private permission registry, so platform and custom checkers cannot leak between roots or generations.

Remove Core's duplicate permit parser, checker, legacy `PermissionFeature`, and process-global platform permit registry. Permit syntax and evaluation now have one owner in `@zhin.js/permission`, and scene-management tool construction no longer mutates global authorization state.
