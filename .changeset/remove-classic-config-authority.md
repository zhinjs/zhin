---
'@zhin.js/core': minor
'zhin.js': minor
---

Remove the unmounted classic Config and Schema Feature registries, schema-driven Endpoint provisioning service, and their service-locator based Adapter hooks. Runtime configuration now has one generation-owned authority through `ConfigComposer`, `ConfigView`, and `primaryConfigToken`; adapter endpoint configuration remains owned by `@zhin.js/adapter` and its explicit command surface.
