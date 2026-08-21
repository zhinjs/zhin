---
'@zhin.js/agent': major
'@zhin.js/cli': patch
'@zhin.js/host-http': major
---

Remove the process-global Assistant, orchestration, session-tree, and OrchestrationService registries. Agent tools now receive their explicitly owned OrchestrationService, while Host and Console operations resolve narrow projections exclusively from the request's generation-owned `AgentHostPort`. Shadow generations can no longer publish operational state before commit, retired generations cannot leak back into service, and Console no longer receives concrete mutable repositories, engines, ingress objects, or orchestration services.

Also remove the unused process-global bootstrap gate, connection authorization queue, session agent-state store, and the empty `@zhin.js/agent/connection` compatibility subpath. The inert state-authoring contract is removed in full: `defineState`, its public definition/discovery types, `DiscoveredPluginAgentSurface.states`, `AgentSurfacePluginInfo.states`, and `agent/state/*` discovery/reporting no longer exist. These experimental APIs had no production authority or lifecycle owner; connection authorization and durable state must be supplied by explicit generation-owned ports instead.
