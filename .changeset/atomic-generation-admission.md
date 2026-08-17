---
'@zhin.js/plugin-runtime': major
'@zhin.js/runtime': major
'@zhin.js/core': minor
'@zhin.js/agent': minor
'@zhin.js/pagemanager': minor
'@zhin.js/cli': patch
---

Restrict Root consumers to the read-only `SnapshotReader` lease interface and
remove public `RootRuntime.controller` access. Generation commit, transaction,
close, and stop authority now remain inside the Root lifecycle.

Close Root admission when rollback cleanup or retired-generation disposal can
no longer prove lifecycle integrity. Existing leases may drain, but new
operations and generation transactions fail closed until the Process Host
stops the Root.
