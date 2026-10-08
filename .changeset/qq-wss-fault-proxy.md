---
"@zhin.js/adapter-qq": patch
---

Add an optional fixed loopback WSS fault proxy that preserves gateway Host/SNI and TLS peer verification. Move reconnect ownership to EndpointLifecycle and keep QQ authentication, discovery, message APIs and uploads direct. Extend the pinned SDK patch with instance-scoped WebSocket agent/factory and reconnect controls, and opt adapters out of SDK process-level error handlers to prevent listener accumulation.
