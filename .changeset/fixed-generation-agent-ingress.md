---
"@zhin.js/plugin-runtime": major
"@zhin.js/core": major
"@zhin.js/agent": major
"@zhin.js/cli": major
"@zhin.js/mcp-feature": major
---

Require generation leases at the IM ingress route instead of exposing a bare
snapshot. Snapshot leases are store-owned, expose their active state, and can
be rejected when presented to an Agent Runtime attached to another Root.

Project configured MCP clients into the generation lifecycle. Configured
servers must become ready during candidate activation; activation failure is
fail-closed and leaves the previous generation serving traffic. Agent bindings
filter the MCP servers visible to a turn, and MCP tools use owner-qualified
`${qualifiedServer}__${tool}` names with fail-closed approval metadata.
