---
"@zhin.js/im-contract": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/adapter": patch
"@zhin.js/tool": patch
"@zhin.js/skill": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/service-activity-feedback": patch
---

ADR 0044 C3: runtime consumers read capabilities instead of platform names. Scene facts (group info, member profile) are queried where the profile declares `scene.groupInfo` / `scene.memberProfile`; activity feedback (reaction, typing, status message, refresh interval, quote-only delivery) follows `feedback`, `actions.reaction` and `delivery.proactive` and the per-platform table is gone; large inline media is spooled only where `delivery.spool` is declared; the sandbox ingress and its console shell follow a new additive `runtime.sandbox` capability. `defineAgentTool` and Skill frontmatter accept `requiresCapabilities` (for example `actions.mute`), evaluated against the per-turn `TurnCapabilities`, so moderation tools disappear when the Bot is not an administrator and return when it is; the icqq/qq keyword boost in tool selection is removed and the icqq group-admin tools are tagged. The `icqq` command-line special case in the exec policy is now a generic `registerSensitiveExecCommand` rule registered by the icqq plugin. `EndpointCapabilities` gains a serializable per-kind `kinds` view. Adapters without a profile keep their previous behaviour (their derived profile also reads the management ports they implement).
