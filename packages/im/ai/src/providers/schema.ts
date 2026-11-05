import { resolveEffectiveOutputTokens } from '../llm/llm-api-runtime.js';
import { z } from 'zod';
import type { ProviderSchema } from '../provider/driver.js';
import type { OpenAiCompatFlags } from '../llm/types/model.js';
import type { ImageGenerationDefaults } from '../image-generation.js';
import type { GeminiContextCacheConfig } from '../llm/gemini-context-cache.js';
import type { SdkFamily } from './sdk-family.js';
import type { ModelDefinition } from '../provider/types.js';

// Same persisted-address contract as the personal model network boundary.
const authenticationParameters = new Set([
  'key', 'apikey', 'xapikey', 'apisecret', 'apitoken', 'accesskey', 'secretkey', 'secretaccesskey',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'auth', 'authorization',
  'password', 'passwd', 'secret', 'clientsecret', 'credential', 'credentials', 'privatekey',
  'signature', 'sig', 'oauthtoken', 'oauthtokensecret', 'xamzcredential', 'xamzsignature',
  'xgoogcredential', 'xgoogsignature',
]);
function authenticationField(name: string): boolean {
  return authenticationParameters.has(name.replace(/[-_]/gu, '').toLowerCase())
    // Vendor prefixes do not turn an authentication field into public metadata.
    || /(?:^|[-_])(?:api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|client[-_]?secret|authorization|password|secret|credentials?|signature|cookie)$/iu.test(name);
}

export function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid provider configuration');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown provider configuration field');
  return value;
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid provider configuration value');
  return value.trim();
}

export function endpoint(value: unknown, fallback?: string): string {
  const address = optionalString(value) ?? fallback;
  if (!address) throw new Error('A provider endpoint is required');
  const parsed = new URL(address);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error('Invalid provider endpoint');
  }
  for (const key of parsed.searchParams.keys()) {
    if (authenticationField(key)) throw new Error('Credentials belong in the account');
  }
  return parsed.href.replace(/\/$/, '');
}

/** One declaration generates both runtime parsing and the Console's input description. */
export function providerSchema<S extends z.ZodType>(shape: S): ProviderSchema<z.output<S>> {
  const inputSchema = Object.freeze(z.toJSONSchema(shape, { io: 'input', target: 'draft-7' }));
  return { inputSchema, parse(input) {
    try { return shape.parse(input === undefined ? {} : input); }
    catch (error) {
      if (error instanceof z.ZodError) throw new Error('Invalid Provider configuration');
      throw error;
    }
  } };
}

const protocolShape = z.strictObject({
  supportsDeveloperRole: z.boolean().optional(), includeUsage: z.boolean().optional(), appendV1: z.boolean().optional(),
  structuredOutput: z.enum(['native', 'prompt']).optional(), promptCacheKey: z.boolean().optional(),
  midConversationSystem: z.enum(['system', 'developer', 'none']).optional(),
});
const cacheShape = z.strictObject({ mode: z.enum(['implicit', 'explicit']).optional(),
  ttlSeconds: z.number().nonnegative().optional(), minPrefixChars: z.number().nonnegative().optional() });
const headersShape = z.record(z.string(), z.string()).transform(headers => {
  for (const name of Object.keys(headers)) {
    if (authenticationField(name)) throw new Error('Authentication headers belong in the account');
  }
  return headers;
});
export const serviceFields = {
  headers: headersShape.optional(), authScheme: z.string().regex(/^[^\r\n]*$/).transform(value => value.trim()).optional(),
};
const compatibilityShapes = {
  openai: protocolShape.pick({ supportsDeveloperRole: true, appendV1: true, structuredOutput: true, midConversationSystem: true }),
  'openai-compatible': protocolShape.pick({ appendV1: true, includeUsage: true, structuredOutput: true, promptCacheKey: true, midConversationSystem: true }),
  anthropic: protocolShape.pick({ structuredOutput: true, midConversationSystem: true }),
  google: protocolShape.pick({ structuredOutput: true, midConversationSystem: true }),
  deepseek: protocolShape.pick({ structuredOutput: true, midConversationSystem: true }),
  minimax: protocolShape.pick({ structuredOutput: true, midConversationSystem: true }),
};
export function compatibleServiceFields() {
  return { ...serviceFields, compat: compatibilityShapes['openai-compatible'].optional() };
}

export interface StandardServiceOptions {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly authScheme?: string;
  readonly compat?: OpenAiCompatFlags;
  readonly contextCache?: GeminiContextCacheConfig;
}
export interface FixedServiceOptions { readonly baseUrl: string }

export function serviceSchema(baseUrl?: string, family: SdkFamily = 'openai-compatible') {
  const address = baseUrl ? z.string().default(baseUrl) : z.string();
  return providerSchema(z.strictObject({ baseUrl: address.transform(value => endpoint(value)), ...serviceFields,
    compat: compatibilityShapes[family].optional() }));
}
export function googleServiceSchema(baseUrl: string) {
  return providerSchema(z.strictObject({ baseUrl: z.string().default(baseUrl).transform(value => endpoint(value)), ...serviceFields,
    compat: compatibilityShapes.google.optional(),
    contextCache: cacheShape.optional() }));
}
export function fixedServiceSchema(baseUrl: string): ProviderSchema<FixedServiceOptions> {
  return providerSchema(z.strictObject({ baseUrl: z.literal(baseUrl).default(baseUrl) }));
}

const budget = z.number().int().nonnegative().max(2_147_483_647);
export const modelParameterShape = z.strictObject({
  temperature: z.number().optional(), maxOutputTokens: z.number().int().positive().optional(),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high']).optional(),
  requestTimeoutMs: budget.optional(), maxRetries: z.number().int().nonnegative().optional(),
  firstChunkTimeoutMs: budget.optional(), chunkTimeoutMs: budget.optional(),
  safetySettings: z.array(z.strictObject({ category: z.string(), threshold: z.string() })).optional(),
  imageGeneration: z.strictObject({
    watermarkEnabled: z.boolean().optional(), defaultSize: z.string().optional(),
    numSteps: z.number().int().positive().optional(), quality: z.string().optional(),
    aspectRatio: z.string().optional(), imageSize: z.string().optional(), promptSuffix: z.string().optional(),
    background: z.enum(['auto', 'transparent', 'opaque']).optional(),
  }).optional(),
});
export interface StandardModelParameters {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
  readonly requestTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly firstChunkTimeoutMs?: number;
  readonly chunkTimeoutMs?: number;
  readonly safetySettings?: readonly Readonly<{ category: string; threshold: string }>[];
  readonly imageGeneration?: Omit<ImageGenerationDefaults, 'defaultModel'> & Readonly<{ background?: 'auto' | 'transparent' | 'opaque' }>;
}
/** One model-aware declaration serves persistence, execution and the Console form. */
interface SdkProfileInput {
  family: SdkFamily; model: ModelDefinition; codex?: boolean; restImage?: 'minimax' | 'cloudflare';
}
export function sdkProfileSchema(input: Readonly<SdkProfileInput & { codex: true }>): ProviderSchema<Omit<StandardModelParameters, 'temperature' | 'maxOutputTokens' | 'imageGeneration' | 'safetySettings'>>;
export function sdkProfileSchema(input: Readonly<SdkProfileInput>): ProviderSchema<StandardModelParameters>;
export function sdkProfileSchema(input: Readonly<SdkProfileInput>): ProviderSchema<StandardModelParameters> {
  const { model, family } = input;
  if (model.kinds.length !== 1) throw new Error('A Profile requires one model protocol kind');
  if (model.kinds[0] === 'language') {
    const base = input.codex ? modelParameterShape.omit({ temperature: true, maxOutputTokens: true, imageGeneration: true, safetySettings: true })
      : family === 'google' ? modelParameterShape.omit({ imageGeneration: true }) : modelParameterShape.omit({ imageGeneration: true, safetySettings: true });
    const described = input.codex ? base : base.extend({ maxOutputTokens: modelParameterShape.shape.maxOutputTokens.describe(
      `Optional output budget. When omitted, the current declared model maximum or the existing framework budget is used (${resolveEffectiveOutputTokens({ declared: model.maxOutputTokens })}). Explicit request options take precedence.`) });
    return providerSchema(described.extend({ thinkingLevel: model.thinking === true ? modelParameterShape.shape.thinkingLevel : z.literal('off').optional() }));
  }
  if (model.kinds[0] !== 'image') throw new Error('Unsupported model kind');
  const image = modelParameterShape.shape.imageGeneration.unwrap();
  const imageParameters = input.restImage === 'cloudflare' ? image.pick({ promptSuffix: true, numSteps: true })
    : input.restImage === 'minimax' ? image.pick({ promptSuffix: true, aspectRatio: true, ...(model.id === 'image-01' ? { defaultSize: true } : {}) })
      : family === 'google' ? image.pick({ promptSuffix: true, aspectRatio: true, imageSize: true })
        : family === 'openai-compatible' ? image.pick({ promptSuffix: true, defaultSize: true, quality: true, background: true, watermarkEnabled: true })
          : family === 'openai' ? image.pick({ promptSuffix: true, defaultSize: true, quality: true, background: true }) : undefined;
  if (!imageParameters) throw new Error('Unsupported image protocol');
  return providerSchema(z.strictObject({ requestTimeoutMs: modelParameterShape.shape.requestTimeoutMs,
    firstChunkTimeoutMs: modelParameterShape.shape.firstChunkTimeoutMs,
    maxRetries: input.restImage ? z.literal(0).optional() : modelParameterShape.shape.maxRetries,
    imageGeneration: imageParameters.optional() }));
}
