/**
 * Groq (GroqCloud) behind `sdk: openai-compatible`: request fixes and model defaults.
 *
 * Groq speaks the OpenAI chat-completions protocol with a few differences:
 *
 * - **Reasoning replay.** `@ai-sdk/openai-compatible` sends earlier reasoning back on
 *   assistant messages as `reasoning_content`; Groq rejects that field with a 400
 *   ("property 'reasoning_content' is unsupported"), so the second step of every tool
 *   loop failed. Groq accepts the same text as `reasoning` (the field it streams in
 *   `delta.reasoning`, which the SDK already reads), so the field is renamed.
 * - **Unsupported fields.** `logprobs`, `top_logprobs`, `logit_bias` and `n` other than
 *   1 are rejected with a 400 (https://console.groq.com/docs/openai); they are dropped.
 * - **Reasoning effort.** Only GPT-OSS and Qwen 3 accept `reasoning_effort`
 *   (https://console.groq.com/docs/reasoning). GPT-OSS defaults to `low` here, which
 *   keeps answers fast and inside the free tier's 8K tokens per minute; `thinkingLevel:
 *   medium | high` (or `providerOptions`) overrides it. On other models the field is
 *   dropped, so one provider-wide `thinkingLevel` cannot break a Llama request.
 * - **Images.** GPT-OSS is text-only (an image part is a 400); Llama 4 Scout / Maverick
 *   take images. See {@link groqDefaultModelInput}.
 *
 * Applies only to Groq: provider alias `groq` / `groqcloud`, or a `baseUrl` on host
 * `api.groq.com`.
 */
import type { ModelInputModality } from './types/model.js';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_ALIASES: readonly string[] = ['groq', 'groqcloud'];
const GROQ_HOST = 'api.groq.com';

/** Default `reasoning_effort` for GPT-OSS on Groq when nothing else sets it. */
export const GROQ_DEFAULT_REASONING_EFFORT = 'low';

const GPT_OSS = /(?:^|\/)gpt-oss-/i;
/** Models that accept `reasoning_effort` on Groq. */
const REASONING_EFFORT_MODELS = /(?:^|\/)(?:gpt-oss-|qwen3)/i;
/** Groq-hosted models that take image input. */
const VISION_MODELS = /llama-4-(?:scout|maverick)/i;

function hostOf(baseUrl: string | undefined): string | undefined {
  const raw = baseUrl?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** True for the Groq gateway: alias `groq` / `groqcloud`, or `baseUrl` on `api.groq.com`. */
export function isGroqGateway(alias: string | undefined, baseUrl: string | undefined): boolean {
  if (alias && GROQ_ALIASES.includes(alias.trim().toLowerCase())) return true;
  return hostOf(baseUrl) === GROQ_HOST;
}

/** Input modalities of a Groq model when `input` is not configured. */
export function groqDefaultModelInput(modelId: string): readonly ModelInputModality[] {
  return VISION_MODELS.test(modelId) && !GPT_OSS.test(modelId) ? ['text', 'image'] : ['text'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `transformRequestBody` for `@ai-sdk/openai-compatible` when talking to Groq. */
export function transformGroqRequestBody(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...body };

  if (Array.isArray(out.messages)) {
    out.messages = out.messages.map((message: unknown) => {
      if (!isRecord(message) || message.role !== 'assistant' || !('reasoning_content' in message)) return message;
      const { reasoning_content: reasoningContent, ...rest } = message;
      return rest.reasoning === undefined && reasoningContent != null ? { ...rest, reasoning: reasoningContent } : rest;
    });
  }

  delete out.logprobs;
  delete out.top_logprobs;
  delete out.logit_bias;
  if (out.n !== undefined && out.n !== 1) delete out.n;

  const modelId = typeof out.model === 'string' ? out.model : '';
  if (!REASONING_EFFORT_MODELS.test(modelId)) {
    delete out.reasoning_effort;
  } else if (out.reasoning_effort === undefined && GPT_OSS.test(modelId)) {
    out.reasoning_effort = GROQ_DEFAULT_REASONING_EFFORT;
  }
  return out;
}
