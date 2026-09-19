---
"@zhin.js/cli": minor
"@zhin.js/core": minor
"zhin.js": minor
---

Remove plugin.yml build detection, package-name heuristics, and the unused Core PluginManifest type. Smart builds now recognize plugins through the canonical package.json zhin manifest and applications through an explicit zhin.js dependency.
