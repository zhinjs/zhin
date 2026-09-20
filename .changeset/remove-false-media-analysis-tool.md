---
"@zhin.js/agent": patch
"zhin.js": patch
---

Remove the detached `analyze_media` Tool that reported images as model-ready without injecting them into a model turn. Inbound images now use the canonical media pipeline directly: vision-capable providers receive native image input, while unsupported providers report that limitation explicitly. File tools no longer direct callers to a nonexistent analysis path.
