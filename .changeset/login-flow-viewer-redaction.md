---
"@zhin.js/host-http": patch
"@zhin.js/core": patch
---

`login.list` / `login.flow.list` / `login.flow.get` return live challenge material (QR image, sensitive copy blocks, verification links, legacy `payload.image` / `payload.url`) only to callers holding `endpoint.operate` on that Endpoint; read-only (`endpoint.view`) callers get the event-safe form (ADR 0058 §8). `LoginAssist.eventSafeFlow()` exposes `withoutLoginMedia` to the Console host.
