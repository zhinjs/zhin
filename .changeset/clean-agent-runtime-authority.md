---
'@zhin.js/agent': major
---

Remove the unreachable classic Plugin bootstrap, process-global authoring registration, and the parallel HTTP Agent session runtime. Agent setup is now owned exclusively by the Plugin Runtime composition root, authoring capabilities are published only through generation projections, and transport approval must be supplied explicitly through `ApprovalPort`.

Also remove the classic proactive-dispatch factory and stop `AIService` standalone agents from fabricating an authenticated IM message. Standalone execution without an authenticated IM origin now carries no message authority and therefore remains fail-closed under tool policy.

BREAKING CHANGE: `initAgentModule`, `createAgentSessionHostPort`, `HttpAgentSessionStore`, `FileHttpSessionPersistence`, `HttpStepProjector`, `HttpApprovalWaiter`, `createProactiveOutboundService`, `registerPluginAgentSurfaces`, and related HTTP-session types are removed. Protocol hosts must execute canonical `TurnRequest` values through the generation-owned `AgentHostPort`; proactive delivery must be implemented by the generation-owned IM runtime.
