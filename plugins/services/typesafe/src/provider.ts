import { defineProvider, type ModelDefinition, type ProviderSchema, type ProviderService } from '@zhin.js/ai/provider';
import { TypeSafeDecisionProvider } from './decision-provider.js';

interface TypeSafeServiceOptions { readonly baseUrl: string }
interface TypeSafeParameters { readonly timeoutMs?: number; readonly maxRetries?: number }
const serviceInput = { type: 'object', additionalProperties: false, properties: {
  baseUrl: { type: 'string', format: 'uri', default: 'https://api.typesafe.ai' },
} } as const;
const budgets = {
  timeoutMs: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
  maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
} as const;
const modelContracts = [{ protocol: 'typesafe-system-one', kinds: ['decision'] }] as const;

function fields(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid TypeSafe configuration');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(name => !allowed.includes(name))) throw new Error('Unknown TypeSafe configuration field');
  return value;
}

const serviceSchema: ProviderSchema<TypeSafeServiceOptions> = { inputSchema: serviceInput, parse(input) {
  const value = fields(input, ['baseUrl']);
  if (value.baseUrl !== undefined && typeof value.baseUrl !== 'string') throw new Error('Invalid TypeSafe endpoint');
  const url = new URL(typeof value.baseUrl === 'string' ? value.baseUrl : serviceInput.properties.baseUrl.default);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Invalid TypeSafe endpoint');
  return { baseUrl: url.href.replace(/\/$/, '') };
} };

const decisionProfileSchema: ProviderSchema<TypeSafeParameters> = { inputSchema: { type: 'object', additionalProperties: false, properties: budgets }, parse(input) {
  const value = fields(input, Object.keys(budgets));
  for (const [key, limits] of Object.entries(budgets)) {
    const number = value[key];
    if (number !== undefined && (typeof number !== 'number' || !Number.isSafeInteger(number) || number < limits.minimum || number > limits.maximum)) throw new Error('Invalid TypeSafe request budget');
  }
  return value as TypeSafeParameters;
} };

/** Actual Choice/Score/Noul service. A chat JSON generator cannot publish this contract. */
function profileSchema({ model }: Readonly<{ service: ProviderService<TypeSafeServiceOptions>; model: ModelDefinition }>): ProviderSchema<TypeSafeParameters> {
  if (model.protocol !== modelContracts[0].protocol || model.kinds.length !== 1 || model.kinds[0] !== 'decision') throw new Error('Invalid TypeSafe Profile protocol');
  return decisionProfileSchema;
}
export const typeSafeProvider = defineProvider({
  id: 'typesafe', label: 'TypeSafe AI', contractVersion: '1', serviceSchema,
  profileSchema, modelContracts,
  identity: service => ({ product: 'typesafe', baseUrl: service.options.baseUrl }),
  authentication: { methods: ['api-key'] },
  targets: service => ({ authentication: [], inference: [service.options.baseUrl] }),
  models(service): Readonly<Record<string, ModelDefinition>> {
    for (const [id, model] of Object.entries(service.models)) {
      if (model.id !== id || model.protocol !== modelContracts[0].protocol || model.kinds.length !== 1 || model.kinds[0] !== modelContracts[0].kinds[0]) throw new Error('Invalid TypeSafe model contract');
    }
    return service.models;
  },
  createExecution(options) {
    return { decision: {
      async evaluate(request) {
        const signal = AbortSignal.any([options.signal, request.signal]);
        const baseUrl = options.binding.service.options.baseUrl;
        const first = await options.credentials.authorize({ target: new URL(baseUrl), signal });
        if (!first.token) throw new Error('TypeSafe account is not authorized');
        const callRequests = new Set<Request>();
        const fetch: typeof globalThis.fetch = async (url, init) => {
          const input = new Request(url, init);
          if (url instanceof Request) callRequests.add(url);
          const currentSignal = init?.signal ?? (url instanceof Request ? url.signal : signal);
          const grant = await options.credentials.authorize({ target: new URL(input.url), signal: currentSignal });
          if (!grant.token) throw new Error('TypeSafe account is not authorized');
          const headers = new Headers(input.headers);
          for (const [name, value] of Object.entries(grant.headers)) headers.set(name, value);
          headers.set('authorization', `Bearer ${grant.token}`);
          const request = new Request(input, { headers, signal: currentSignal });
          const bound = options.credentials.bindRequest({ grant, request });
          callRequests.add(request); callRequests.add(bound);
          return options.fetch(bound);
        };
        const provider = new TypeSafeDecisionProvider({
          apiKey: first.token, baseUrl, model: options.binding.model.id,
          ...options.binding.profile.parameters,
        }, { fetch });
        try {
          return await provider.evaluate({ state: request.state, questions: request.questions, model: options.binding.model.id }, {
            signal, timeoutMs: request.timeoutMs,
          });
        } finally { provider.dispose(); callRequests.clear(); }
      },
    } };
  },
});

declare module '@zhin.js/ai/provider' {
  interface AIProviderRegistry { typesafe: typeof typeSafeProvider }
}
