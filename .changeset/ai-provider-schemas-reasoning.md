---
"@zhin.js/ai": patch
---

Provider fixes from the #736 audit (PR C):

- Tool JSON Schemas go to every provider as written. `enum`, `const`, `anyOf`/`oneOf`, nullable types, `integer`, `format` and bounds are kept, and tool-call arguments are validated against the same constraints. Gemini gets a `string` type on untyped fields.
- `thinkingLevel` (provider config, or per call) is sent as the AI SDK `reasoning` option. A thinking setting in `providerOptions` wins, and MiniMax keeps adaptive thinking. New `maxOutputTokens` provider option (default 8192).
- Assistant turns are stored and replayed thinking-first, so a turn with Anthropic thinking + text + tool_use stays valid. Gemini `thoughtSignature` on thought and text parts round-trips.
- OpenAI GPT-4o and later, the o1/o3/o4-mini models, and Claude 3+ models default to image input.
