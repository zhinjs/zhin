import type { LanguageModelCallStartEvent } from 'ai';
import type { LlmRequestObservation, StreamOptions } from '../llm-api-runtime.js';

/** Observe SDK-prepared tools without re-evaluating a tool's schema or cloning media bytes. */
export function observeModelRequest(
  observer: StreamOptions['onRequest'],
  request: LanguageModelCallStartEvent,
  outputSchema?: Record<string, unknown>,
): void {
  if (!observer) return;
  let observation: LlmRequestObservation;
  try {
    const tools = (request.tools ?? []).map(tool => ({
      name: String(tool.name),
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      inputSchema: textSnapshot(tool.inputSchema),
    }));
    observation = { status: 'captured', input: {
      ...(request.instructions === undefined ? {} : { system: textSnapshot(request.instructions) }),
      messages: request.messages.map(textSnapshot),
      tools,
      ...(outputSchema === undefined ? {} : { output_schema: textSnapshot(outputSchema) }),
    } };
  } catch {
    observation = { status: 'capture_failed' };
  }
  try {
    // An async observer is allowed to settle independently; diagnostics never gate the request.
    void Promise.resolve(observer(observation)).catch(() => undefined);
  } catch {
    // Observer exceptions are diagnostic failures, not provider failures.
  }
}

/** Media is metadata only. Text is immutable; ordinary objects are copied before observers see them. */
function textSnapshot(value: unknown): unknown {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return { type: 'binary', omitted: true };
  if (value instanceof URL) return value.protocol === 'data:' ? { type: 'binary', omitted: true } : value.href;
  if (typeof value === 'string') return value.startsWith('data:') ? '[media omitted]' : value;
  if (Array.isArray(value)) return value.map(textSnapshot);
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  if (item.type === 'file' || item.type === 'image' || item.type === 'reasoning-file') {
    return { type: item.type, ...(typeof item.mediaType === 'string' ? { mediaType: item.mediaType } : {}), omitted: true };
  }
  return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, textSnapshot(entry)]));
}
