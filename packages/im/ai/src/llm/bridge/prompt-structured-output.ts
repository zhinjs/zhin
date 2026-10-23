/**
 * Structured output by instruction instead of the provider's JSON mode.
 *
 * DeepSeek's thinking models in `response_format: json_object` mode often think and then return
 * only whitespace (measured: 4 of 8 chat replies), while the same prompt without JSON mode
 * returned a usable object 12 of 12 times. For such models the schema goes into the system
 * prompt and the reply text is decoded leniently.
 */
import type { Context } from '../types/context.js';
import type { Model } from '../types/model.js';
import { parseLenientJsonObject } from './lenient-json.js';

export type StructuredOutputMode = 'native' | 'prompt';

/** `compat.structuredOutput` wins; DeepSeek defaults to `prompt`, every other SDK to `native`. */
export function structuredOutputMode(model: Pick<Model, 'sdk' | 'compat'>): StructuredOutputMode {
  return model.compat?.structuredOutput ?? (model.sdk === 'deepseek' ? 'prompt' : 'native');
}

export function withStructuredOutputInstruction(context: Context, schema: Record<string, unknown>): Context {
  const instruction = [
    'Respond with only a JSON object that matches this JSON Schema: no prose before or after it and no Markdown fence.',
    JSON.stringify(schema),
  ].join('\n');
  return { ...context, systemPrompt: context.systemPrompt ? `${context.systemPrompt}\n\n${instruction}` : instruction };
}

/** The canonical JSON of the object the model wrote, or the text unchanged when it wrote none. */
export function normalizePromptStructuredText(text: string): string {
  const value = parseLenientJsonObject(text);
  return value === undefined ? text : JSON.stringify(value);
}
