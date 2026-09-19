---
'@zhin.js/core': minor
'zhin.js': minor
---

Remove the unused classic `ComponentFeature` registry and `Plugin.addComponent` extension. Component definitions are discovered and projected by the generation-owned Component Feature, while Core keeps only the message and JSX rendering primitives it owns.
