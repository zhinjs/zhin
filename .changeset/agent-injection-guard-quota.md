---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

feat(agent): injection guard, outbound leak check and usage quotas (#727). Once external content (tool results, web pages, files, sub-agent reports, background group events) has entered a turn, shell commands, messages to other conversations, config changes and scheduled tasks always go through the ApprovalPort, with the source chain on the approval card; unattended turns deny them (`ai.agent.injectionGuard.confirmHighRisk`, default on). Replies, progress updates and outbound tool messages now mask verbatim system-prompt lines, secrets and other sessions' memory before delivery (`ai.agent.injectionGuard.outboundCheck`, default on). New `ai.agent.usageQuota` adds per-user / per-group token quotas and a per-group rate limit, all off by default, owner exempt.
