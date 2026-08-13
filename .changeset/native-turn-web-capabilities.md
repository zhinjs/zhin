---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Publish `web_fetch` and `web_search` as native generation-owned ToolFeatures on the canonical IM Turn path.

Both tools now use one Turn-scoped network module that authorizes every redirect hop, rejects non-public DNS results, pins the socket connection to the reviewed address while preserving HTTPS SNI and Host, enforces cancellation, timeout, redirect, and response-size limits, and records transport policy rejection as a canonical denied tool event. Interactive IM turns receive HTTPS authority only from the explicit `network` execution preset.

BREAKING CHANGE: the canonical web tools no longer consume ambient AsyncLocalStorage network policy or automatic fetch redirects. Deployments must explicitly select the `network` preset, and non-public or non-HTTPS targets fail closed.
