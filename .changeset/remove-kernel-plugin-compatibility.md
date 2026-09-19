---
"@zhin.js/kernel": minor
"@zhin.js/core": minor
"zhin.js": minor
---

Remove the unused Kernel PluginBase, mutable Feature registry, string-based dependency injection, and prototype extension registry. Plugin lifecycle now belongs solely to the generation-owned Plugin Runtime, while capability discovery and projection belong to Feature Kit.
