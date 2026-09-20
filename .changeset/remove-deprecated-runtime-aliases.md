---
"@zhin.js/scaffold-wizard": patch
"@zhin.js/host-http": patch
"@zhin.js/service-activity-feedback": patch
"@zhin.js/cli": patch
"create-zhin-app": patch
---

Remove deprecated runtime authoring aliases instead of carrying two names for one concept. AI setup now accepts only `agentProvider` and exposes `resolveAgentProviderFromConfig`, HTTP Host consumers use the canonical Console endpoint contract directly, and activity feedback resolution goes through `ActivityFeedbackPolicy`.
