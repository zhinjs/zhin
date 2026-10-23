---
"@zhin.js/agent": patch
---

Never send tool-call markup as a chat message. DeepSeek sometimes writes a tool call as text (`<｜｜DSML｜｜ calls>…`), which the plain-prose fallback forwarded to the group verbatim. Replies containing DSML, `<invoke>`, `<tool_call>` or similar markup are rejected in JSON and in prose, are not reworded by the format correction (that would announce an action that never ran), and fall back to the host failure notice. `<text>…</text>` wrappers are split into one message each.
