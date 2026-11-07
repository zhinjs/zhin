import type { ModelInputModality } from '../llm/types/model.js';
import type { ModelDefinition, ModelKind } from '../provider/types.js';

export interface ModelCapabilityBaseline {
  readonly input: readonly ModelInputModality[];
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly thinking: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export interface ModelCapabilityCatalogEntry extends ModelCapabilityBaseline {
  readonly family: string;
  readonly pattern: RegExp;
}

export interface InferModelCapabilitiesInput {
  readonly modelId: string;
  readonly protocol?: string;
  readonly kinds?: readonly (ModelKind | string)[];
}

const TEXT_ONLY: readonly ModelInputModality[] = Object.freeze(['text']);
const TEXT_AND_IMAGE: readonly ModelInputModality[] = Object.freeze(['text', 'image']);

/**
 * Built-in baseline capability catalog for mainstream LLM families.
 * Ordered from most specific to most general within each vendor family.
 * Explicit user overrides in `ai.plan.yml` or `ProviderService.models` always win over this baseline.
 */
export const MODEL_CAPABILITY_CATALOG: readonly ModelCapabilityCatalogEntry[] = Object.freeze([
  // Google Gemini
  {
    family: 'gemini-thinking',
    pattern: /^(?:gemini-2\.5-|gemini-3|gemini-2\.0-flash-thinking)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
  },
  {
    family: 'gemini',
    pattern: /^gemini-/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
  },

  // Anthropic Claude
  {
    family: 'claude-thinking',
    pattern: /^(?:claude-(?:sonnet|opus)-4|claude-haiku-4[-.]5|claude-4|claude-3[-.]7)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
  },
  {
    family: 'claude-3-and-4',
    pattern: /^claude-(?:3|haiku-4)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
  },

  // OpenAI & Codex
  {
    family: 'openai-o1-legacy',
    pattern: /^o1-(?:mini|preview)\b/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: false,
    thinking: true,
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
  },
  {
    family: 'openai-o3-mini',
    pattern: /^o3-mini\b/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
  },
  {
    family: 'openai-reasoning-multimodal',
    pattern: /^(?:gpt-5|codex|o1|o3|o4)\b/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
  },
  {
    family: 'openai-gpt-4.1',
    pattern: /^gpt-4\.1\b/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
  },
  {
    family: 'openai-gpt-4o',
    pattern: /^(?:gpt-4o|gpt-4\.5|chatgpt-4o|gpt-4-turbo|gpt-4-(?:\d+-)?vision)\b/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  },
  {
    family: 'openai-gpt-4',
    pattern: /^gpt-4\b/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },

  // DeepSeek
  {
    family: 'deepseek-vision',
    pattern: /^(?:deepseek-vl\d*|deepseek-.*vision)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    family: 'deepseek-reasoning',
    pattern: /^(?:deepseek-reasoner|deepseek-r1|deepseek-v3\.[12])/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 128_000,
    maxOutputTokens: 64_000,
  },
  {
    family: 'deepseek-chat',
    pattern: /^deepseek-/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },

  // Alibaba Qwen
  {
    family: 'qwen-reasoning-vision',
    pattern: /^(?:qwen3-(?:vl|omni)|qvq|qwen.*-(?:vl|omni).*thinking)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
  },
  {
    family: 'qwen-vision',
    pattern: /^(?:qwen(?:\d+(?:\.\d+)?)?-(?:vl|omni))/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
  },
  {
    family: 'qwen-reasoning',
    pattern: /^(?:qwen3|qwq|qwen-(?:plus|max|turbo)-latest)/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
  },
  {
    family: 'qwen-chat',
    pattern: /^qwen/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
  },

  // Zhipu GLM
  {
    family: 'glm-thinking-vision',
    pattern: /^glm-(?:4\.[5-9]v|4(?:\.\d+)?v-.*thinking|z1.*vision)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  },
  {
    family: 'glm-vision',
    pattern: /^glm-4(?:\.\d+)?-?(?:v|vision)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    family: 'glm-thinking',
    pattern: /^glm-(?:4\.[5-9]|5|z1)/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
  },
  {
    family: 'glm-chat',
    pattern: /^glm-/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },

  // Moonshot Kimi
  {
    family: 'kimi-vision-thinking',
    pattern: /^kimi-(?:k2\.5|latest|k1\.5.*vision)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
  },
  {
    family: 'kimi-thinking',
    pattern: /^(?:kimi-k[12]|kimi-thinking|moonshot-v1-thinking)/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
  },
  {
    family: 'moonshot-vision',
    pattern: /^(?:moonshot-v1-.*vision|kimi-(?:vl|.*vision))/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    family: 'moonshot-chat',
    pattern: /^(?:moonshot-|kimi-)/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },

  // MiniMax
  {
    family: 'minimax-thinking',
    pattern: /^minimax-m[12]/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 200_000,
    maxOutputTokens: 32_768,
  },
  {
    family: 'minimax-chat',
    pattern: /^(?:minimax|abab)/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },

  // xAI Grok
  {
    family: 'grok-thinking',
    pattern: /^grok-[34]/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
  },
  {
    family: 'grok-vision',
    pattern: /^grok-2-vision/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
  },
  {
    family: 'grok-chat',
    pattern: /^grok-/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
  },

  // ByteDance Doubao
  {
    family: 'doubao-seed',
    pattern: /^(?:doubao-seed|doubao-.*(?:thinking.*vision|vision.*thinking))/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
  },
  {
    family: 'doubao-thinking',
    pattern: /^doubao-.*thinking/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: true,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  },
  {
    family: 'doubao-vision',
    pattern: /^doubao-.*vision/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    family: 'doubao-chat',
    pattern: /^doubao-/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },

  // Meta Llama & Mistral
  {
    family: 'vision-multimodal',
    pattern: /^(?:pixtral|llama-?4|llama-?3\.2-.*vision)/iu,
    input: TEXT_AND_IMAGE,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    family: 'llama-mistral-chat',
    pattern: /^(?:llama-?3|mistral|codestral)/iu,
    input: TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
]);

function normalizeModelId(modelId: string): string {
  return modelId.trim().replace(/^(?:[^/]+\/)+/u, '');
}

const EXPLICIT_VISION_SUFFIX_PATTERN = /vision|-vl\d*(?:\b|[-_:])/iu;
const EXPLICIT_THINKING_SUFFIX_PATTERN = /thinking|reasoner|-r1(?:\b|[-_:])/iu;

export function inferModelCapabilities(input: InferModelCapabilitiesInput): ModelCapabilityBaseline {
  if (input.kinds && !input.kinds.includes('language')) {
    return {
      input: TEXT_ONLY,
      streaming: false,
      toolCalling: false,
      thinking: false,
    };
  }
  const normalized = normalizeModelId(input.modelId);
  const explicitVision =
    input.protocol === 'google-generate-content' ||
    EXPLICIT_VISION_SUFFIX_PATTERN.test(normalized);
  const explicitThinking = EXPLICIT_THINKING_SUFFIX_PATTERN.test(normalized);
  for (const entry of MODEL_CAPABILITY_CATALOG) {
    if (entry.pattern.test(normalized)) {
      return {
        input: entry.input === TEXT_ONLY && explicitVision ? TEXT_AND_IMAGE : entry.input,
        streaming: entry.streaming,
        toolCalling: entry.toolCalling,
        thinking: entry.thinking || explicitThinking,
        ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
        ...(entry.maxOutputTokens !== undefined ? { maxOutputTokens: entry.maxOutputTokens } : {}),
      };
    }
  }
  return {
    input: explicitVision ? TEXT_AND_IMAGE : TEXT_ONLY,
    streaming: true,
    toolCalling: true,
    thinking: explicitThinking,
  };
}

export function inferDefaultModelInput(
  modelId: string,
  protocol?: string,
  kinds?: readonly string[],
): readonly ModelInputModality[] {
  return inferModelCapabilities({ modelId, protocol, kinds }).input;
}

/**
 * Fill omitted capability fields on a `ModelDefinition` using the built-in catalog baseline.
 * Any explicitly configured field on `model` (`input`, `streaming`, `toolCalling`, `thinking`,
 * `contextWindow`, `maxOutputTokens`) takes strict precedence over the inferred baseline.
 */
export function applyModelCapabilityDefaults(model: ModelDefinition): ModelDefinition {
  const baseline = inferModelCapabilities({
    modelId: model.id,
    protocol: model.protocol,
    kinds: model.kinds,
  });
  return {
    ...model,
    input: model.input !== undefined ? model.input : baseline.input,
    streaming: model.streaming !== undefined ? model.streaming : baseline.streaming,
    toolCalling: model.toolCalling !== undefined ? model.toolCalling : baseline.toolCalling,
    thinking: model.thinking !== undefined ? model.thinking : baseline.thinking,
    ...(model.contextWindow !== undefined
      ? { contextWindow: model.contextWindow }
      : baseline.contextWindow !== undefined
        ? { contextWindow: baseline.contextWindow }
        : {}),
    ...(model.maxOutputTokens !== undefined
      ? { maxOutputTokens: model.maxOutputTokens }
      : baseline.maxOutputTokens !== undefined
        ? { maxOutputTokens: baseline.maxOutputTokens }
        : {}),
  };
}
