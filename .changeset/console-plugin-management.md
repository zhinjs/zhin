---
'@zhin.js/cli': patch
'@zhin.js/client': patch
'@zhin.js/console-protocol': patch
'@zhin.js/host-http': patch
---

Add a shared CLI and Console plugin-management transaction for install, update,
uninstall, configuration validation, lifecycle control, diagnostics, Marketplace
discovery, and Endpoint connectivity checks. Console mutations use revision checks,
exact-version plans, post-operation verification, and recoverable manifest and
lockfile snapshots.
