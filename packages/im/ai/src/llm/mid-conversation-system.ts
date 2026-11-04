/**
 * ADR 0041 §2.1: whether a provider accepts a system / developer message in the middle of a
 * conversation. Violating it makes some providers reject the request or silently drop the message,
 * so the default is conservative and only remote OpenAI-protocol endpoints opt in.
 */
import type { Model } from './types/model.js';

export type MidConversationSystem = 'system' | 'developer' | 'none';

export const MID_CONVERSATION_SYSTEM_VALUES: readonly MidConversationSystem[] = Object.freeze(['system', 'developer', 'none']);

export function isMidConversationSystem(value: unknown): value is MidConversationSystem {
  return typeof value === 'string' && (MID_CONVERSATION_SYSTEM_VALUES as readonly string[]).includes(value);
}

/** OpenAI reasoning families that take instructions as `developer` (o1 / o3 / o4-mini / gpt-5 …). */
function isOpenAiReasoningModel(id: string | undefined): boolean {
  return /^(o\d|gpt-5)/iu.test(id ?? '');
}

/** Self-hosted endpoints (vLLM / Ollama / LM Studio …), whose chat templates may reject a mid-conversation system. */
export function isLocalEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  } catch {
    return false;
  }
  return host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.localhost')
    || /^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host) || /^172\.(1[6-9]|2\d|3[01])\./u.test(host);
}

/**
 * Per-model resolution. An explicit `compat.midConversationSystem` always wins; otherwise:
 * OpenAI → `system` (reasoning models `developer`, `system` when `supportsDeveloperRole === false`);
 * remote OpenAI-compatible → `system`; DeepSeek (rejects / drops multiple system segments in
 * context), local (Ollama, vLLM, private hosts), Anthropic, Gemini, MiniMax and anything unknown → `none`
 * (rendered as a `user_id:system` user message).
 */
export function resolveMidConversationSystem(
  model: Pick<Model, 'sdk' | 'id' | 'baseUrl' | 'compat'>,
): MidConversationSystem {
  const explicit = model.compat?.midConversationSystem;
  if (isMidConversationSystem(explicit)) return explicit;
  switch (model.sdk) {
    case 'openai':
      return isOpenAiReasoningModel(model.id) && model.compat?.supportsDeveloperRole !== false ? 'developer' : 'system';
    case 'openai-compatible':
      return isLocalEndpoint(model.baseUrl) ? 'none' : 'system';
    default:
      return 'none';
  }
}
