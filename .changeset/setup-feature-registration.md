---
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/adapter": patch
"@zhin.js/command": patch
"@zhin.js/component": patch
"@zhin.js/feature-kit": patch
"@zhin.js/agent-feature": patch
"@zhin.js/mcp-feature": patch
"@zhin.js/middleware": patch
"@zhin.js/skill": patch
"@zhin.js/tool": patch
---

Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
Setup definitions now share provider validation, projections, conflicts, ownership, and generation
lifecycle with convention-discovered capability files. Feature providers can declare their own
shortcut through `authoring.setupMethod`.
