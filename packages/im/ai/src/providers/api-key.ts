import { z } from 'zod';
import { defineProvider, type ProviderDiscoveryOptions, type ProviderSchema } from '../provider/driver.js';
import { ProviderError, type ModelDefinition, type ProviderService } from '../provider/types.js';
import { endpoint, sdkProfileSchema, serviceSchema, googleServiceSchema, providerSchema, compatibleServiceFields, type StandardServiceOptions, type StandardModelParameters } from './schema.js';
import { sdkExecution } from './sdk-execution.js';
import type { SdkFamily } from './sdk-family.js';
import { restImageExecution } from './rest-image.js';
import { executionTraits, serviceIdentity } from './traits.js';
import { discoverModels } from './discovery.js';
import { normalizeAnthropicBaseUrl, normalizeGoogleBaseUrl, normalizeOpenAiCompatibleBaseUrl, withoutEndpointQuery, appendEndpointPath } from '../llm/sdk-endpoints.js';

interface Protocol {
  readonly name: string;
  readonly kind: 'language' | 'image';
  readonly api?: string;
}
export function modelContracts(protocols: readonly Protocol[]) {
  return protocols.map(protocol => ({ protocol: protocol.name, kinds: [protocol.kind] }));
}
const MINIMAX_LANGUAGE_BASE = 'https://api.minimax.io/anthropic/v1';
const MINIMAX_IMAGE_ENDPOINT = 'https://api.minimaxi.com/v1/image_generation';
function nativeMiniMaxImages(service: StandardServiceOptions): boolean {
  return service.baseUrl === MINIMAX_LANGUAGE_BASE;
}
function cloudflareNativeBase(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}
function cloudflareImageBase(service: StandardServiceOptions & { accountId: string }): string | undefined {
  return service.baseUrl === cloudflareNativeBase(service.accountId)
    ? `https://api.cloudflare.com/client/v4/accounts/${service.accountId}/ai/run` : undefined;
}

/** Configured model metadata is authoritative; no name heuristics or startup network probes. */
export function declaredModels(
  service: ProviderService<unknown>,
  protocols: readonly Protocol[],
): Readonly<Record<string, ModelDefinition>> {
  for (const [id, model] of Object.entries(service.models)) {
    const protocol = protocols.find(item => item.name === model.protocol);
    if (id !== model.id || !protocol || !model.kinds.length || model.kinds.some(kind => kind !== protocol.kind)) {
      throw new Error('Model definition does not match this Provider protocol');
    }
  }
  return service.models;
}

function apiKeyProvider<const Id extends string, const Methods extends readonly ('api-key' | 'none')[], S extends StandardServiceOptions>(input: {
  readonly id: Id;
  readonly family: SdkFamily;
  readonly label: string;
  readonly serviceSchema: ProviderSchema<S>;
  readonly nativeDeferredTools?: boolean;
  readonly protocols: readonly Protocol[];
  readonly methods: Methods;
  readonly discovery?: 'openai' | 'anthropic' | 'google';
}) {
  const format = input.discovery;
  const profileSchema = ({ service, model }: Readonly<{ service: ProviderService<S>; model: ModelDefinition }>): ProviderSchema<StandardModelParameters> => {
    const protocol = input.protocols.find(item => item.name === model.protocol);
    if (!protocol || model.kinds.some(kind => kind !== protocol.kind)) throw new Error('Invalid Profile protocol');
    if (input.family === 'minimax' && protocol.kind === 'image' && !nativeMiniMaxImages(service.options)) throw new ProviderError('unsupported-capability');
    return sdkProfileSchema({ family: input.family, model, ...(input.family === 'minimax' && protocol.kind === 'image' ? { restImage: 'minimax' } : {}) });
  };
  return defineProvider({
    id: input.id, label: input.label, contractVersion: '1',
    identity: service => serviceIdentity({ product: input.id, service: service.options }),
    modelContracts: modelContracts(input.protocols),
    describeModel: ({ service, model, profile }) => executionTraits({ family: input.family, service: service.options, parameters: profile.parameters, model, nativeDeferredTools: input.nativeDeferredTools }),
    serviceSchema: input.serviceSchema,
    profileSchema,
    authentication: { methods: input.methods },
    targets: service => ({ authentication: [], inference: [withoutEndpointQuery(service.options.baseUrl), ...(input.family === 'minimax' && nativeMiniMaxImages(service.options) ? [MINIMAX_IMAGE_ENDPOINT] : [])],
      ...(format ? { discovery: [withoutEndpointQuery(service.options.baseUrl)] } : {}) }),
    models: service => declaredModels(service, input.protocols),
    ...(format ? { discover: (options: ProviderDiscoveryOptions<StandardServiceOptions>) => {
      const endpoint = new URL(options.service.options.baseUrl);
      const plain = withoutEndpointQuery(endpoint.href);
      const base = format === 'google' ? normalizeGoogleBaseUrl(plain)!
        : format === 'anthropic' ? normalizeAnthropicBaseUrl(plain)!
          : normalizeOpenAiCompatibleBaseUrl(plain, options.service.options.compat?.appendV1);
      const target = new URL(appendEndpointPath(base, 'models')); target.search = endpoint.search;
      return discoverModels(options, { endpoint: target.href, format, anonymous: input.methods.includes('none') });
    } } : {}),
    createExecution(options) {
      const protocol = input.protocols.find(item => item.name === options.binding.model.protocol);
      if (!protocol) throw new Error('Unsupported Provider model protocol');
      if (input.family === 'minimax' && protocol.kind === 'image') {
        if (!nativeMiniMaxImages(options.binding.service.options)) throw new ProviderError('unsupported-capability');
        return restImageExecution(options, { protocol: 'minimax', endpoint: MINIMAX_IMAGE_ENDPOINT });
      }
      return sdkExecution(options, {
        family: input.family, api: protocol.api,
        image: protocol.kind === 'image', noAuthentication: options.binding.account.authentication.method === 'none', normalizeEndpoint: true,
      });
    },
  });
}

export const openAiProvider = apiKeyProvider({
  id: 'openai', label: 'OpenAI', family: 'openai', methods: ['api-key'], discovery: 'openai', serviceSchema: serviceSchema('https://api.openai.com/v1', 'openai'),
  protocols: [
    { name: 'openai-chat', kind: 'language' },
    { name: 'openai-responses', kind: 'language', api: 'responses' },
    { name: 'openai-images', kind: 'image' },
  ],
});
export const anthropicProvider = apiKeyProvider({
  id: 'anthropic', label: 'Anthropic', family: 'anthropic', methods: ['api-key'], discovery: 'anthropic', nativeDeferredTools: true, serviceSchema: serviceSchema('https://api.anthropic.com/v1', 'anthropic'),
  protocols: [{ name: 'anthropic-messages', kind: 'language' }],
});
export const googleProvider = apiKeyProvider({
  id: 'google', label: 'Google Gemini', family: 'google', methods: ['api-key'], discovery: 'google', serviceSchema: googleServiceSchema('https://generativelanguage.googleapis.com/v1beta'),
  protocols: [{ name: 'google-generate-content', kind: 'language' }, { name: 'google-images', kind: 'image' }],
});
export const deepSeekProvider = apiKeyProvider({
  id: 'deepseek', label: 'DeepSeek', family: 'deepseek', methods: ['api-key'], discovery: 'openai', serviceSchema: serviceSchema('https://api.deepseek.com', 'deepseek'),
  protocols: [{ name: 'openai-chat', kind: 'language' }],
});
export const miniMaxProvider = apiKeyProvider({
  id: 'minimax', label: 'MiniMax', family: 'minimax', methods: ['api-key'], serviceSchema: serviceSchema(MINIMAX_LANGUAGE_BASE, 'minimax'),
  protocols: [{ name: 'anthropic-messages', kind: 'language' }, { name: 'minimax-images', kind: 'image' }],
});
export const ollamaProvider = apiKeyProvider({
  id: 'ollama', label: 'Ollama', family: 'openai-compatible', methods: ['none', 'api-key'], discovery: 'openai', serviceSchema: serviceSchema('http://127.0.0.1:11434/v1'),
  protocols: [{ name: 'openai-chat', kind: 'language' }],
});
export const openAiCompatibleProvider = apiKeyProvider({
  id: 'openai-compatible', label: 'OpenAI compatible', family: 'openai-compatible', methods: ['api-key'], discovery: 'openai', serviceSchema: serviceSchema(),
  protocols: [{ name: 'openai-chat', kind: 'language' }, { name: 'openai-images', kind: 'image' }],
});

const cloudflareProtocols = [{ name: 'openai-chat', kind: 'language' }, { name: 'cloudflare-images', kind: 'image' }] as const;
const cloudflareServiceSchema = providerSchema(z.strictObject({ accountId: z.string().regex(/^[a-zA-Z0-9_-]+$/), baseUrl: z.string().optional(), ...compatibleServiceFields() }).transform(value => ({
  ...value, baseUrl: endpoint(value.baseUrl, cloudflareNativeBase(value.accountId)),
})));
const cloudflareProfileSchema = ({ service, model }: Readonly<{ service: ProviderService<ReturnType<typeof cloudflareServiceSchema.parse>>; model: ModelDefinition }>): ProviderSchema<StandardModelParameters> => {
  if (!cloudflareProtocols.some(protocol => protocol.name === model.protocol && model.kinds.every(kind => kind === protocol.kind))) throw new Error('Invalid Profile protocol');
  if (model.protocol === 'cloudflare-images' && !cloudflareImageBase(service.options)) throw new ProviderError('unsupported-capability');
  return sdkProfileSchema({ family: 'openai-compatible', model, ...(model.protocol === 'cloudflare-images' ? { restImage: 'cloudflare' } : {}) });
};
export const cloudflareProvider = defineProvider({
  id: 'cloudflare', label: 'Cloudflare Workers AI', contractVersion: '1',
  identity: service => serviceIdentity({ product: 'cloudflare', service: service.options, extra: { accountId: service.options.accountId } }),
  modelContracts: modelContracts(cloudflareProtocols),
  describeModel: ({ service, model, profile }) => executionTraits({ family: 'openai-compatible', service: service.options, parameters: profile.parameters, model }),
  serviceSchema: cloudflareServiceSchema, profileSchema: cloudflareProfileSchema, authentication: { methods: ['api-key'] },
  targets: service => {
    const imageBase = cloudflareImageBase(service.options);
    return { authentication: [], inference: [withoutEndpointQuery(service.options.baseUrl), ...(imageBase ? [imageBase] : [])] };
  },
  models: service => declaredModels(service, cloudflareProtocols),
  createExecution(input) {
    if (input.binding.model.protocol === 'cloudflare-images') {
      const imageBase = cloudflareImageBase(input.binding.service.options);
      if (!imageBase) throw new ProviderError('unsupported-capability');
      return restImageExecution(input, { protocol: 'cloudflare', endpoint: `${imageBase}/${input.binding.model.id}` });
    }
    return sdkExecution(input, { family: 'openai-compatible', normalizeEndpoint: true });
  },
});

declare module '@zhin.js/ai/provider' {
  interface AIProviderRegistry {
    openai: typeof openAiProvider;
    anthropic: typeof anthropicProvider;
    google: typeof googleProvider;
    deepseek: typeof deepSeekProvider;
    minimax: typeof miniMaxProvider;
    ollama: typeof ollamaProvider;
    'openai-compatible': typeof openAiCompatibleProvider;
    cloudflare: typeof cloudflareProvider;
  }
}
