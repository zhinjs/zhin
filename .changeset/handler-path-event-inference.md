---
"@zhin.js/handler": patch
---

Map `handlers/**` path localName (`/` segments) to Lifecycle event names (`.` segments) when `event` is omitted, so `handlers/notice/receive.ts` listens on `notice.receive` without invalid capability dots.
