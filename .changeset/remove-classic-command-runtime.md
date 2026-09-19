---
'@zhin.js/core': minor
'zhin.js': minor
---

Remove the classic `MessageCommand` and `CommandFeature` runtime, its Plugin extension, legacy Endpoint command registration, and the command branch in the classic dispatcher. Commands now have one execution model: `defineCommand` definitions projected into the generation-owned `CommandIndex`.
