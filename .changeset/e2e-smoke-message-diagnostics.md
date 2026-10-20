---
"@zhin.js/testing": patch
---

`PluginTestKit` exposes `messageDiagnostics`, the same body-free reader the Console serves at `GET /api/messages/diagnostics`, so integration tests can assert route, dispatch status and delivery outcomes. Adds the first end-to-end smoke scenarios for the #829 loop (v1 → v2 migration, boot, diagnostics API, scenario-lab export).
