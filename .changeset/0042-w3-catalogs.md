---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
---

ADR 0042 W3: fold the resident catalogs. The deferred tool index is one line per domain (MCP server, else owning plugin / builtin area) with up to 6 sorted tool names and the total count, e.g. `calendar: calendar_add, calendar_list (2)`; details come from `discover`. The skill catalog keeps the skill name plus one trigger sentence of at most 40 characters (full description at `load_skill` / `discover`) and is sorted by name so the block is byte-stable. Providers that use prompt-mode structured output (DeepSeek, `compat.structuredOutput: 'prompt'`) now get a compact shape (one example plus one data-shape line per offered segment type, derived from the schema) instead of the full JSON Schema text; native providers still receive the schema as an API parameter and `decodeStructuredReply` still validates with it. `@zhin.js/ai` exports `registerStructuredOutputPromptText`.
