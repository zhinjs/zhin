---
"@zhin.js/plugin-link-poster": patch
---

Replace the module-global Link Poster renderer and reset API with a generation-owned Plugin Runtime resource. The plugin now creates the renderer during setup, and middleware resolves the exact renderer from its operation scope.
