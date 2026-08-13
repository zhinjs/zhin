---
'@zhin.js/agent': major
'@zhin.js/cli': minor
---

Replace schedule management tools' legacy `ZhinTool` and IM `Message` boundary with native Agent Tool definitions and canonical invocation identity. Schedule creation now derives creator and delivery target from the authenticated tool principal and origin.

Remove the process-global Schedule manager registry. Every generated Schedule Tool set closes over its own generation manager, preventing in-flight old-generation turns from crossing into a newer engine.
