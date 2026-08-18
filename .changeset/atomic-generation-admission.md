---
'@zhin.js/plugin-runtime': patch
'@zhin.js/runtime': patch
'@zhin.js/core': patch
'@zhin.js/feature-kit': patch
'@zhin.js/adapter': patch
'@zhin.js/mcp-feature': patch
'@zhin.js/host-http': patch
'@zhin.js/isolate': patch
'@zhin.js/agent': patch
'@zhin.js/pagemanager': patch
'@zhin.js/cli': patch
---

Restrict Root consumers to the read-only `SnapshotReader` lease interface and
remove public `RootRuntime.controller` access. Generation commit, transaction,
close, and stop authority now remain inside the Root lifecycle.

Close Root admission when rollback cleanup or retired-generation disposal can
no longer prove lifecycle integrity. Existing leases may drain, but new
operations and generation transactions fail closed until the Process Host
stops the Root.

Bind externally driven capability resources to lifecycle-owned generation admission gates.
Adapter candidates can establish Endpoint connections during readiness while their IM ingress
remains invisible; snapshot commit atomically retires the old ingress and publishes the new one,
without closing the old Endpoint before the transaction succeeds.
Admitted HTTP, WebSocket, IM, isolated-RPC, Endpoint control, and Endpoint management operations
now retain their exact generation until settlement instead of escaping with a live object.

Remove inert unconfigured Endpoints and deferred soft-start. Configured Endpoint creation,
connection readiness, and local admission are required generation prerequisites; any failure
disposes the complete candidate set and leaves the previous generation serving traffic.

Move the HTTP listener to Process Host ownership. Generation scopes now receive only an
`HttpHost` routing port (without `listen`/`close` authority), and HTTP/WS registrations are tagged
with generation admission so candidate routes cannot shadow committed routes before publish.

Remove the fallible post-commit `openNext` phase and all pre-commit old-generation
quiesce/resume hooks. Handoff now performs candidate readiness and reversible candidate cleanup
only; the previous generation remains untouched until the single synchronous snapshot/admission
publish point, then drains through its existing leases.
Candidate setup, Feature projection, Endpoint readiness, MCP connection, isolation activation,
database activation, and config commit now receive the Root transaction `AbortSignal`; Root Stop
fails closed and awaits candidate cancellation cleanup.
