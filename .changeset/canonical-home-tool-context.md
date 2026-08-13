---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Replace Home Assistant's legacy `ZhinTool` and IM `Message` execution boundary with native generation-owned Agent Tool definitions. Home authorization now consumes the authenticated canonical tool principal, and the CLI publishes Home tools only through the Tool Feature projection.

Configured Agent and Home candidate initialization now fail closed instead of publishing a generation with the requested capability silently absent.
