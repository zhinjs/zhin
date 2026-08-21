---
'@zhin.js/agent': major
'@zhin.js/cli': patch
'@zhin.js/host-http': major
---

Remove the process-global Assistant, orchestration, session-tree, and OrchestrationService registries. Agent tools now receive their explicitly owned OrchestrationService, while Host and Console operations resolve narrow projections exclusively from the request's generation-owned `AgentHostPort`. Shadow generations can no longer publish operational state before commit, retired generations cannot leak back into service, and Console no longer receives concrete mutable repositories, engines, ingress objects, or orchestration services.
