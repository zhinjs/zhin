/**
 * Wire-format builders for the three provider protocols zhin speaks:
 *
 * - `openaiChat`: OpenAI Chat Completions, used by `openai`, `deepseek`,
 *   `ollama` and `openai-compatible`.
 * - `anthropicMessages`: Anthropic Messages, used by `anthropic` and `minimax`.
 * - `geminiGenerate`: Gemini `generateContent` / `streamGenerateContent`, used by `google`.
 *
 * Each `reply()` returns a {@link ProtocolReply} that answers a streamed request
 * with SSE and a non-streamed one with JSON, built from the same description.
 */
import type { MockResponse, ProtocolReply, RecordedRequest, SseEvent } from './mock-fetch.js';

export interface MockToolCall {
  /** Defaults to `call_<index>`. */
  readonly id?: string;
  readonly name: string;
  /** An object is JSON-encoded; a string is sent verbatim (use it for malformed JSON). */
  readonly arguments: Record<string, unknown> | string;
}

function argsText(args: MockToolCall['arguments']): string {
  return typeof args === 'string' ? args : JSON.stringify(args);
}

/** Split a string into `parts` roughly equal chunks (at least one), to exercise delta assembly. */
function chunks(text: string, parts: number): string[] {
  if (parts <= 1 || text.length <= 1) return [text];
  const size = Math.ceil(text.length / parts);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- OpenAI Chat

export interface OpenAiUsage {
  readonly prompt: number;
  readonly completion: number;
  readonly total?: number;
  /** `prompt_tokens_details.cached_tokens` */
  readonly cached?: number;
  /** `completion_tokens_details.reasoning_tokens` */
  readonly reasoning?: number;
  /** DeepSeek's `prompt_cache_hit_tokens`. */
  readonly cacheHit?: number;
}

export interface OpenAiChatReply {
  readonly text?: string;
  /** `reasoning_content` (DeepSeek, most compat gateways). */
  readonly reasoning?: string;
  readonly toolCalls?: readonly MockToolCall[];
  /** `message.refusal` / `delta.refusal` (OpenAI). */
  readonly refusal?: string;
  /** Raw `finish_reason`. Defaults to `tool_calls` with tool calls, else `stop`. */
  readonly finishReason?: string;
  readonly usage?: OpenAiUsage;
  /**
   * When the streamed answer carries usage:
   * - `'if-requested'` (default, real OpenAI semantics): only when the request set `stream_options.include_usage`;
   * - `'always'` / `'never'`.
   */
  readonly streamUsage?: 'if-requested' | 'always' | 'never';
  /** Split text, reasoning and each tool call's arguments into this many deltas. Default 2. */
  readonly deltas?: number;
  readonly model?: string;
}

function openAiUsage(usage: OpenAiUsage) {
  return {
    prompt_tokens: usage.prompt,
    completion_tokens: usage.completion,
    total_tokens: usage.total ?? usage.prompt + usage.completion,
    ...(usage.cached !== undefined ? { prompt_tokens_details: { cached_tokens: usage.cached } } : {}),
    ...(usage.reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: usage.reasoning } } : {}),
    ...(usage.cacheHit !== undefined ? { prompt_cache_hit_tokens: usage.cacheHit, prompt_cache_miss_tokens: usage.prompt - usage.cacheHit } : {}),
  };
}

function openAiFinish(reply: OpenAiChatReply): string {
  return reply.finishReason ?? (reply.toolCalls?.length ? 'tool_calls' : 'stop');
}

export const openaiChat = {
  reply(reply: OpenAiChatReply = {}): ProtocolReply {
    const model = reply.model ?? 'mock-model';
    const base = { id: 'chatcmpl-mock', created: 1_760_000_000, model };
    const parts = reply.deltas ?? 2;
    return {
      kind: 'protocol',
      json: () => ({
        json: {
          ...base,
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: reply.text ?? null,
              ...(reply.reasoning !== undefined ? { reasoning_content: reply.reasoning } : {}),
              ...(reply.refusal !== undefined ? { refusal: reply.refusal } : {}),
              ...(reply.toolCalls?.length
                ? { tool_calls: reply.toolCalls.map((c, i) => ({ id: c.id ?? `call_${i}`, type: 'function', function: { name: c.name, arguments: argsText(c.arguments) } })) }
                : {}),
            },
            finish_reason: openAiFinish(reply),
          }],
          ...(reply.usage ? { usage: openAiUsage(reply.usage) } : {}),
        },
      }),
      stream: (request: RecordedRequest) => {
        const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
          data: { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] },
        });
        const events: SseEvent[] = [chunk({ role: 'assistant', content: '' })];
        if (reply.reasoning) for (const piece of chunks(reply.reasoning, parts)) events.push(chunk({ reasoning_content: piece }));
        if (reply.refusal) events.push(chunk({ refusal: reply.refusal }));
        if (reply.text) for (const piece of chunks(reply.text, parts)) events.push(chunk({ content: piece }));
        reply.toolCalls?.forEach((call, index) => {
          const [first = '', ...rest] = chunks(argsText(call.arguments), parts);
          events.push(chunk({ tool_calls: [{ index, id: call.id ?? `call_${index}`, type: 'function', function: { name: call.name, arguments: first } }] }));
          for (const piece of rest) events.push(chunk({ tool_calls: [{ index, function: { arguments: piece } }] }));
        });
        events.push(chunk({}, openAiFinish(reply)));
        const mode = reply.streamUsage ?? 'if-requested';
        const wantsUsage = mode === 'always' || (mode === 'if-requested' && request.body?.stream_options?.include_usage === true);
        if (reply.usage && wantsUsage) {
          events.push({ data: { ...base, object: 'chat.completion.chunk', choices: [], usage: openAiUsage(reply.usage) } });
        }
        events.push({ data: '[DONE]' });
        return { sse: events };
      },
    };
  },

  /** An HTTP error with the OpenAI error envelope. */
  error(status: number, error: { message: string; type?: string; code?: string | null }, headers?: Record<string, string>): MockResponse {
    return { status, headers, json: { error: { type: 'invalid_request_error', code: null, param: null, ...error } } };
  },

  /** A 200 stream that sends some text, then an in-stream `{ error }` chunk. */
  streamError(error: { message: string; type?: string; code?: string | null }, textBefore = 'partial'): MockResponse {
    const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 1_760_000_000, model: 'mock-model' };
    return {
      sse: [
        { data: { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: textBefore }, finish_reason: null }] } },
        { data: { error: { type: 'server_error', code: null, param: null, ...error } } },
      ],
    };
  },
};

// ---------------------------------------------------------- Anthropic Messages

export type AnthropicBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly thinking: string; readonly signature?: string }
  | { readonly type: 'redacted_thinking'; readonly data: string }
  | { readonly type: 'tool_use'; readonly id?: string; readonly name: string; readonly input: Record<string, unknown> | string };

export interface AnthropicUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export interface AnthropicReply {
  /** Content blocks in the order the model emitted them. */
  readonly blocks?: readonly AnthropicBlock[];
  /** Shorthand for a single text block (appended after `blocks`). */
  readonly text?: string;
  /** Shorthand for tool_use blocks (appended after `text`). */
  readonly toolCalls?: readonly MockToolCall[];
  /** Raw `stop_reason`. Defaults to `tool_use` with tool calls, else `end_turn`. */
  readonly stopReason?: string;
  readonly usage?: AnthropicUsage;
  readonly deltas?: number;
  readonly model?: string;
}

function anthropicBlocks(reply: AnthropicReply): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = [...(reply.blocks ?? [])];
  if (reply.text !== undefined) blocks.push({ type: 'text', text: reply.text });
  reply.toolCalls?.forEach((c, i) => blocks.push({ type: 'tool_use', id: c.id ?? `toolu_${i}`, name: c.name, input: c.arguments }));
  return blocks;
}

function anthropicUsage(usage: AnthropicUsage | undefined, outputOnly = false) {
  const u = usage ?? { input: 10, output: 5 };
  if (outputOnly) return { output_tokens: u.output };
  return {
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_input_tokens: u.cacheRead ?? 0,
    cache_creation_input_tokens: u.cacheWrite ?? 0,
  };
}

export const anthropicMessages = {
  reply(reply: AnthropicReply = {}): ProtocolReply {
    const model = reply.model ?? 'mock-model';
    const blocks = anthropicBlocks(reply);
    const stopReason = reply.stopReason ?? (blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
    const parts = reply.deltas ?? 2;
    const jsonBlock = (b: AnthropicBlock, i: number) => {
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id ?? `toolu_${i}`, name: b.name, input: typeof b.input === 'string' ? JSON.parse(b.input) : b.input };
      if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking, signature: b.signature ?? '' };
      return b;
    };
    return {
      kind: 'protocol',
      json: () => ({
        json: {
          id: 'msg_mock', type: 'message', role: 'assistant', model,
          content: blocks.map(jsonBlock),
          stop_reason: stopReason, stop_sequence: null,
          usage: anthropicUsage(reply.usage),
        },
      }),
      stream: () => {
        const ev = (type: string, data: Record<string, unknown>): SseEvent => ({ event: type, data: { type, ...data } });
        const events: SseEvent[] = [ev('message_start', {
          message: {
            id: 'msg_mock', type: 'message', role: 'assistant', model, content: [],
            stop_reason: null, stop_sequence: null,
            usage: { ...anthropicUsage(reply.usage), output_tokens: 1 },
          },
        })];
        blocks.forEach((block, index) => {
          if (block.type === 'text') {
            events.push(ev('content_block_start', { index, content_block: { type: 'text', text: '' } }));
            for (const text of chunks(block.text, parts)) events.push(ev('content_block_delta', { index, delta: { type: 'text_delta', text } }));
          } else if (block.type === 'thinking') {
            events.push(ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } }));
            for (const thinking of chunks(block.thinking, parts)) events.push(ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking } }));
            if (block.signature) events.push(ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: block.signature } }));
          } else if (block.type === 'redacted_thinking') {
            events.push(ev('content_block_start', { index, content_block: { type: 'redacted_thinking', data: block.data } }));
          } else {
            events.push(ev('content_block_start', { index, content_block: { type: 'tool_use', id: block.id ?? `toolu_${index}`, name: block.name, input: {} } }));
            for (const partial_json of chunks(argsText(block.input), parts)) events.push(ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json } }));
          }
          events.push(ev('content_block_stop', { index }));
        });
        events.push(ev('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: anthropicUsage(reply.usage, true) }));
        events.push(ev('message_stop', {}));
        return { sse: events };
      },
    };
  },

  /** An HTTP error with the Anthropic error envelope (e.g. 529 `overloaded_error`). */
  error(status: number, error: { type: string; message: string }, headers?: Record<string, string>): MockResponse {
    return { status, headers, json: { type: 'error', error } };
  },

  /** A 200 stream that starts a message, sends some text, then an SSE `error` event. */
  streamError(error: { type: string; message: string }, textBefore = 'partial'): MockResponse {
    const reply = anthropicMessages.reply({ text: textBefore, deltas: 1 }).stream({} as RecordedRequest);
    const head = (reply.sse ?? []).slice(0, 3); // message_start, content_block_start, one delta
    return { sse: [...head, { event: 'error', data: { type: 'error', error } }] };
  },
};

// --------------------------------------------------------------- Gemini

export interface GeminiReply {
  /** Raw `candidates[0].content.parts`, or one array per streamed chunk. */
  readonly parts?: readonly Record<string, unknown>[];
  readonly chunks?: readonly (readonly Record<string, unknown>[])[];
  readonly text?: string;
  readonly finishReason?: string;
  readonly usageMetadata?: Record<string, number>;
  readonly promptFeedback?: Record<string, unknown>;
}

export const geminiGenerate = {
  reply(reply: GeminiReply = {}): ProtocolReply {
    const allParts = reply.chunks?.flat() ?? [...(reply.parts ?? []), ...(reply.text !== undefined ? [{ text: reply.text }] : [])];
    const usageMetadata = reply.usageMetadata ?? { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 };
    const candidate = (parts: readonly Record<string, unknown>[], last: boolean) => ({
      content: { role: 'model', parts },
      ...(last ? { finishReason: reply.finishReason ?? 'STOP' } : {}),
    });
    return {
      kind: 'protocol',
      json: () => ({ json: { candidates: [candidate(allParts, true)], usageMetadata, ...(reply.promptFeedback ? { promptFeedback: reply.promptFeedback } : {}) } }),
      stream: () => {
        const perChunk = reply.chunks ?? [allParts];
        return {
          sse: perChunk.map((parts, i) => {
            const last = i === perChunk.length - 1;
            return { data: { candidates: [candidate(parts, last)], ...(last ? { usageMetadata } : {}) } };
          }),
        };
      },
    };
  },

  error(status: number, error: { message: string; status: string; details?: unknown[] }): MockResponse {
    return { status, json: { error: { code: status, ...error } } };
  },
};
