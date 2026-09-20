---
'@zhin.js/agent': patch
---

Remove the unused classic `AgentFeature` and `MCPFeature` registries from the Agent root API. Agent presets and MCP connections now have one authority each: the generation-owned `AgentIndex` and `McpIndex` projections provided by their dedicated Feature packages.
