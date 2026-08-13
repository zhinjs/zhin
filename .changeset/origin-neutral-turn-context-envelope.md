---
'@zhin.js/agent': patch
---

Make the public Turn Context Envelope consume canonical Turn origin, principal, and session data instead of IM `Message`. IM metadata is now validated and projected only by the ingress adapter, while Schedule, HTTP, A2A, and internal Turns describe their native origins without fabricated platform fields.
