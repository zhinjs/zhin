# Provider test harness

This harness runs the real zhin transport (`LlmApiRuntime` → `streamText` → `@ai-sdk/*`) against a mocked HTTP endpoint. Only the network is fake: the provider SDK builds the request and parses the response, so a test pins down the exact wire format each provider sends and accepts.

```ts
import { createProviderHarness, openaiChat, anthropicMessages, geminiGenerate } from '../../helpers/provider-harness/index.js';

const h = createProviderHarness({ sdk: 'deepseek' });          // defaults: model, apiKey 'test-key', baseUrl
h.reply(openaiChat.reply({ reasoning: '先想想', text: '答案', usage: { prompt: 40, completion: 10, cacheHit: 32 } }));

const message = await h.complete({ system: 'sys', user: 'q', tools: [weather] });
expect(h.lastRequest().body.messages[0]).toEqual({ role: 'system', content: 'sys' });
expect(message.usage.cacheRead).toBe(32);
```

## `createProviderHarness(options)`

| option | default | meaning |
|---|---|---|
| `sdk` | (required) | any `SdkId`: `openai`, `anthropic`, `google`, `deepseek`, `minimax`, `ollama`, `openai-compatible` |
| `model` | `PROVIDER_DEFAULTS[sdk].model` | model id |
| `config` | `PROVIDER_DEFAULTS[sdk].config` | merged over the default `ProviderInstanceConfig` (`baseUrl`, `headers`, `compat`, `providerOptions`, ...) |
| `alias` | `'mock'` | provider alias |
| `responses` | `[]` | initial response queue |

The returned harness provides:

- `reply(...responders)` queues responses. Each request consumes one.
- `complete(input, streamOptions?)` runs the agent path (`LlmApiRuntime.complete`, streamed) and returns the `AssistantMessage`.
- `events(input, streamOptions?)` sends the same request and returns every stream event (`text_delta`, `thinking_delta`, `toolcall_delta`, `done`, `error`).
- `resilient(resilienceOptions?).complete(input)` wraps the same runtime in the #724 resilience layer (retry, timeout, fallback). Pass `sleep`, `timers` and `random` to keep it deterministic.
- `adapter()` returns an `SdkProviderAdapter` on the same fetch, for `completeText` (non-streamed `generateText`) and `listModels`.
- `requests`, `lastRequest()` and `server.requestsTo('/chat/completions')` give you what the SDK sent: `{ method, url, path, headers (lower-case), body (parsed JSON), rawBody, stream }`.
- `model` is the transport `Model` descriptor (`input`, `contextWindow`, `providerOptions`), and `runtime`, `config` and `context(input)` are also exposed.

`input` can be a user string, or `{ system?, messages?, user?, tools? }`. `user` is appended as the last message. Use `h.context({ user })` to rebuild earlier turns when you replay a tool loop:

```ts
const first = await h.complete({ user: '上海？', tools: [weather] });
await h.complete({ messages: [...h.context({ user: '上海？' }).messages, first, toolResult], tools: [weather] });
```

## Protocol builders (`protocols.ts`)

Pick the builder by `PROVIDER_PROTOCOL[sdk]`:

| builder | sdks |
|---|---|
| `openaiChat` | `openai`, `deepseek`, `ollama`, `openai-compatible` |
| `anthropicMessages` | `anthropic`, `minimax` |
| `geminiGenerate` | `google` |

Each builder's `reply(...)` returns a `ProtocolReply`. It answers a streamed request with SSE and a non-streamed request with JSON, both built from the same description:

- `openaiChat.reply({ text, reasoning, toolCalls, refusal, finishReason, usage: { prompt, completion, cached, reasoning, cacheHit }, streamUsage, deltas })`. `streamUsage` defaults to `'if-requested'`, which matches real OpenAI semantics: usage is streamed only when the request sets `stream_options.include_usage`. Use `'always'` or `'never'` to model other servers.
- `anthropicMessages.reply({ blocks, text, toolCalls, stopReason, usage: { input, output, cacheRead, cacheWrite }, deltas })`. `blocks` keeps the model's order, mixing `thinking` (with `signature`), `redacted_thinking`, `text` and `tool_use`, so tests can check ordering and replay.
- `geminiGenerate.reply({ parts | chunks, text, finishReason, usageMetadata, promptFeedback })`. Pass raw parts so you can include `thoughtSignature`, `thought: true` or `functionCall`.
- `*.error(status, error, headers?)` returns an HTTP error with the provider's error envelope (for `Retry-After` tests, put it in `headers`).
- `openaiChat.streamError(...)` and `anthropicMessages.streamError(...)` return a 200 stream that fails part-way through.
- `MockToolCall.arguments` may be a string, which is sent verbatim (use it for malformed JSON). `deltas` (default 2) splits text, reasoning and arguments into chunks so tests exercise delta assembly.

## Literal responses and functions

A responder can also be a literal `MockResponse` (`{ status, headers, json | sse | text, hang }`) or a function `(request) => MockResponse | ProtocolReply`. Use a function to assert on the request inline or to vary the answer.

`hang: 'before-headers' | 'after-events'` simulates a stuck server. The request then ends only when the caller's `AbortSignal` fires, which makes it the tool for timeout tests.

Stall timeouts come from the provider config, so a stall test is two lines:

```ts
const h = createProviderHarness({ sdk: 'openai', config: { chunkTimeoutMs: 50 } });
const partial = openaiChat.reply({ text: 'partial' }).stream({ body: {} } as never);
h.reply({ sse: (partial.sse ?? []).slice(0, 2), hang: 'after-events' });
const error = await h.complete('hi', { maxRetries: 0 }).catch((e: unknown) => e);
expect(classifyProviderError(error)).toMatchObject({ kind: 'timeout' });
```

`firstChunkTimeoutMs` pairs with `hang: 'before-headers'`.

`createMockFetch().route(match, responder)` adds a persistent responder that is checked before the queue, for example `GET /models` discovery or Ollama `/api/show`.

If a request arrives and nothing is queued, the harness throws `provider-harness: no mocked response queued for …`, so unexpected requests make the test fail.

## Conventions

- Keep one suite per sdk under `tests/llm/providers/<sdk>.test.ts`. The Gemini suite stays in `tests/llm/google-gemini-provider.test.ts`.
- Assert `rawBody` never contains `TEST_API_KEY`. The key belongs in headers only.
- Pass `{ maxRetries: 0 }` to `complete()` in error tests, so the SDK's own retry does not consume extra queued responses.
