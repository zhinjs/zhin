---
"@zhin.js/scaffold-wizard": minor
"@zhin.js/host-http": minor
"@zhin.js/service-activity-feedback": minor
"@zhin.js/cli": minor
"create-zhin-app": patch
---

Remove deprecated runtime authoring aliases instead of carrying two names for one concept. AI setup now accepts only `agentProvider` and exposes `resolveAgentProviderFromConfig`, HTTP Host consumers use the canonical Console endpoint contract directly, and activity feedback resolution goes through `ActivityFeedbackPolicy`.
