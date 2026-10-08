---
"@zhin.js/tool": patch
"@zhin.js/mcp-feature": patch
"@zhin.js/skill": patch
"@zhin.js/agent-feature": patch
"@zhin.js/agent": patch
"@zhin.js/mcp": patch
---

Recognize versioned Tool, MCP, Skill and Agent projections across native generation module identities, so protocol ingress retains visible capabilities and fixed-generation execution guards. Keep MCP tools/list available with an empty tool set and reject unknown calls explicitly instead of advertising an unavailable method.

Bind reused Tool projections to the explicit operation snapshot: new requests read current generation config, resources and projections, while in-flight requests keep their leased generation and retirement guards.
