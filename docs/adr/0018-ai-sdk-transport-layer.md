# ADR 0018: AI SDK Transport Layer

## Status

Accepted

## Context

[ADR 0009](0009-pi-aligned-ai-agent-core.md) established the pi-shaped agent loop (`agentLoop`, `Context`, `stream()`, `complete()`). The LLM wire layer was initially implemented with vendor-specific HTTP clients and `AIProvider.chat()` bridges.

[Vercel AI SDK](https://ai-sdk.dev/providers/ai-sdk-providers) provides mature, maintained provider transports. Maintaining parallel HTTP stacks (preset/spec, anthropic-bridge, openai-completions) duplicated effort and drifted from upstream fixes.

## Decision

1. **AI SDK is the LLM transport** inside `@zhin.js/ai` only. `@ai-sdk/*` and `ai` are **not** re-exported from public package APIs.

2. **Keep ADR 0009 surface unchanged**: `agentLoop`, `Context`, `stream()`, `complete()`, `AssistantMessageEventStream`.

3. **Configuration hard break**: `ai.providers.<alias>.sdk` replaces `api`, `driver`, `preset`, and `spec`.

   Closed sdk table (Phase 1):

   | sdk | Notes |
   |-----|-------|
   | `openai` | `@ai-sdk/openai` |
   | `anthropic` | `@ai-sdk/anthropic` |
   | `google` | `@ai-sdk/google` |
   | `deepseek` | `@ai-sdk/deepseek` |
   | `ollama` | `@ai-sdk/openai-compatible` → `{host}/v1` |
   | `openai-compatible` | Gateways, 智谱, Moonshot, Cloudflare Workers AI chat |

4. **Single ApiProvider** registered as `ai-sdk`; `getModel()` returns `api: 'ai-sdk'` with internal `sdk` metadata.

5. **Model discovery unchanged**: yaml `models:` whitelist → `/v1/models` (OpenAI-compat) → static fallback.

6. **Image generation (Phase 1)** uses AI SDK `generateImage` where supported (`openai`, `google`, `openai-compatible`). **Exception**: Cloudflare Workers AI images remain on legacy `/ai/run/{model}` HTTP (non–OpenAI-compat path).

7. **IM naming unchanged**: `endpoints` (platform bots) vs `ai.providers` (LLM instances) remain separate concepts.

## Consequences

### Positive

- One transport implementation; provider fixes flow from AI SDK releases.
- Config is simpler (`sdk` + connection params).
- pi agent loop and harness tests remain stable.

### Negative / limits

- `@ai-sdk/ollama` is not published; Ollama uses OpenAI-compatible shim.
- Not every gateway combo supports AI SDK image APIs; validate at config/runtime and document support matrix.
- Persisted assistant messages may still contain legacy `api` values from older sessions; runtime uses `ai-sdk`.

## References

- [ADR 0009](0009-pi-aligned-ai-agent-core.md) — agent loop contract
- [ADR 0010](0010-pi-coding-agent-harness-alignment.md) — harness alignment
- `packages/im/ai/src/llm/sdk-registry.ts` — sdk factory
- `packages/im/ai/src/llm/bridge/` — Context ↔ AI SDK bridge
