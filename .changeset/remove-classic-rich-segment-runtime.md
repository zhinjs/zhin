---
"@zhin.js/core": patch
"zhin.js": patch
---

Remove the disconnected classic Rich Segment class hierarchy, mutable registry, renderer policies, optional-peer loaders, and adapter contract facade. `segment.html`, `segment.markdown`, `segment.qrcode`, and `segment.tts` now create canonical message segments directly; Plugin Runtime's generation-owned outbound normalization remains the sole rendering and media-negotiation path.
