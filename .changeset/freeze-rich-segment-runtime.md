---
'@zhin.js/core': minor
---

Make the Rich Segment runtime immutable. Built-in kinds and optional capability loaders are now fixed when Core initializes, while each send operation owns its capability cache.

Remove the process-global kind and loader registration APIs and their test reset hooks. `RichSegmentRegistry` now receives all definitions in its constructor, validates them atomically, and exposes frozen definitions and default policies.
