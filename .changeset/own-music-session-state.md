---
"@zhin.js/plugin-music": minor
---

Move pending music selections and QR login coordination into the generation-owned `MusicRuntime`. The plugin now creates and disposes isolated `MusicSearchSessions` and `QrLoginRuntime` instances instead of sharing process-global maps and login providers across reloads.
