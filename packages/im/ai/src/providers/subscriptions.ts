import { createRequire } from 'node:module';
import { defineProvider, type ProviderSchema } from '../provider/driver.js';
import type { ModelDefinition, ProviderService } from '../provider/types.js';
import { fixedServiceSchema, sdkProfileSchema, type StandardModelParameters, type FixedServiceOptions } from './schema.js';
import { sdkExecution, ProviderProtocolError } from './sdk-execution.js';
import { declaredModels, modelContracts } from './api-key.js';
import { codexOAuth, claudeOAuth } from './oauth.js';
import { discoverModels } from './discovery.js';
import { executionTraits, serviceIdentity } from './traits.js';
import { CODEX_CLIENT_NOTICE, EXPERIMENTAL_SUBSCRIPTION_NOTICE } from './support.js';

const require = createRequire(import.meta.url);
const version = (require('../../package.json') as { version: string }).version;
const userAgent = `zhin.js-ai/${version}`;

const codexBase = 'https://chatgpt.com/backend-api/codex';
const codexCacheRouting = 'driver';
const codexProtocols = [{ name: 'codex-responses', kind: 'language' }] as const;
const claudeProtocols = [{ name: 'anthropic-messages', kind: 'language' }] as const;
type ProfileInput = Readonly<{ service: ProviderService<FixedServiceOptions>; model: ModelDefinition }>;
type CodexParameters = Omit<StandardModelParameters, 'temperature' | 'maxOutputTokens' | 'imageGeneration' | 'safetySettings'>;
function codexProfileSchema({ model }: ProfileInput): ProviderSchema<CodexParameters> {
  if (model.protocol !== codexProtocols[0].name || model.kinds.length !== 1 || model.kinds[0] !== 'language') throw new Error('Invalid Profile protocol');
  const schema = sdkProfileSchema({ family: 'openai', model, codex: true });
  return { ...schema, parse(input: unknown) { try { return schema.parse(input); } catch { throw new ProviderProtocolError('unsupported-parameter'); } } };
}
function claudeProfileSchema({ model }: ProfileInput): ProviderSchema<StandardModelParameters> {
  if (model.protocol !== claudeProtocols[0].name || model.kinds.length !== 1 || model.kinds[0] !== 'language') throw new Error('Invalid Profile protocol');
  return sdkProfileSchema({ family: 'anthropic', model });
}

export const codexProvider = defineProvider({
  id: 'codex-subscription', label: 'Codex subscription', contractVersion: '1',
  support: { status: 'standard', notice: CODEX_CLIENT_NOTICE },
  identity: service => serviceIdentity({ product: 'codex-subscription', service: service.options }),
  modelContracts: modelContracts(codexProtocols),
  describeModel: ({ service, model, profile }) => ({ ...executionTraits({ family: 'openai', service: service.options, parameters: profile.parameters, model }), promptCacheRouting: codexCacheRouting }),
  serviceSchema: fixedServiceSchema(codexBase),
  profileSchema: codexProfileSchema,
  authentication: { methods: ['oauth'], oauth: codexOAuth },
  targets: () => ({ authentication: ['https://auth.openai.com/oauth'], inference: [codexBase] }),
  models: service => declaredModels(service, codexProtocols),
  createExecution(input) {
    return sdkExecution(input, {
      family: 'openai', api: 'responses', sessionHeader: 'session_id', forceStreamingGeneration: true, promptCacheRouting: codexCacheRouting,
      // Required before SDK history conversion; a wire-only store=false is too late.
      providerOptions: { openai: { store: false } },
      headers(grant) {
        const account = grant.metadata?.chatgptAccountId;
        return { 'user-agent': userAgent, originator: 'zhin', ...(typeof account === 'string' ? { 'chatgpt-account-id': account } : {}) };
      },
      validateRequest(request) {
        if (request.options?.temperature !== undefined || request.options?.maxTokens !== undefined
          || request.options?.promptCacheKey !== undefined || request.options?.promptCacheRetention !== undefined) throw new ProviderProtocolError('unsupported-parameter');
      },
      prepareRequest({ request, body, sessionId }) {
        body.store = false;
        body.stream = true;
        delete body.previous_response_id;
        for (const key of ['max_output_tokens', 'temperature', 'top_p', 'metadata', 'safety_identifier', 'prompt_cache_retention']) delete body[key];
        body.prompt_cache_key = sessionId;
        const include = Array.isArray(body.include) ? body.include.filter((item): item is string => typeof item === 'string') : [];
        body.include = [...new Set([...include, 'reasoning.encrypted_content'])];
        if (body.instructions === undefined) body.instructions = '';
        if (Array.isArray(body.input)) {
          body.input = body.input.filter(item => !item || typeof item !== 'object' || item.type !== 'item_reference').map(item => {
            if (!item || typeof item !== 'object') return item;
            const copied = { ...item };
            // store=false cannot resolve server-owned ids; preserve real function call IDs.
            if (typeof copied.id === 'string' && /^(?:rs|fc|resp|msg)_/.test(copied.id)) delete copied.id;
            if (copied.role === 'system') copied.role = 'developer';
            return copied;
          });
        }
        return { url: request.url, body };
      },
    });
  },
});

export const claudeSubscriptionProvider = defineProvider({
  id: 'claude-subscription', label: 'Claude subscription', contractVersion: '1',
  support: { status: 'experimental', notice: EXPERIMENTAL_SUBSCRIPTION_NOTICE },
  identity: service => serviceIdentity({ product: 'claude-subscription', service: service.options }),
  modelContracts: modelContracts(claudeProtocols),
  describeModel: ({ service, model, profile }) => executionTraits({ family: 'anthropic', service: service.options, parameters: profile.parameters, model, nativeDeferredTools: true }),
  serviceSchema: fixedServiceSchema('https://api.anthropic.com/v1'),
  profileSchema: claudeProfileSchema,
  authentication: { methods: ['oauth'], oauth: claudeOAuth },
  targets: () => ({ authentication: ['https://api.anthropic.com/v1/oauth'], inference: ['https://api.anthropic.com/v1/messages'] }),
  models: service => declaredModels(service, claudeProtocols),
  createExecution: input => sdkExecution(input, {
    family: 'anthropic', bearer: true,
    credentialTarget: 'https://api.anthropic.com/v1/messages',
    headers: () => ({ 'user-agent': userAgent, 'anthropic-beta': 'oauth-2025-04-20' }),
  }),
});

const openCodeProtocols = [
  { name: 'openai-chat', kind: 'language' },
  { name: 'openai-responses', kind: 'language' },
  { name: 'anthropic-messages', kind: 'language' },
  { name: 'google-generate-content', kind: 'language' },
] as const;

function openCodeProvider<const Product extends 'go' | 'zen'>(product: Product) {
  const prefix = `https://opencode.ai/inference${product === 'go' ? '/go' : ''}`;
  const profileSchema = ({ model }: ProfileInput): ProviderSchema<StandardModelParameters> => {
    if (!openCodeProtocols.some(protocol => protocol.name === model.protocol) || model.kinds.length !== 1 || model.kinds[0] !== 'language') throw new Error('Invalid Profile protocol');
    return sdkProfileSchema({ family: model.protocol === 'google-generate-content' ? 'google' : model.protocol === 'anthropic-messages' ? 'anthropic'
      : model.protocol === 'openai-responses' ? 'openai' : 'openai-compatible', model });
  };
  return defineProvider({
    id: `opencode-${product}`, label: product === 'go' ? 'OpenCode Go' : 'OpenCode Zen', contractVersion: '1',
    support: { status: 'standard' },
    identity: service => serviceIdentity({ product: `opencode-${product}`, service: service.options }),
    modelContracts: modelContracts(openCodeProtocols),
    describeModel: ({ service, model, profile }) => executionTraits({ family: model.protocol === 'anthropic-messages' ? 'anthropic' : model.protocol === 'google-generate-content' ? 'google' : model.protocol === 'openai-chat' ? 'openai-compatible' : 'openai', service: service.options, parameters: profile.parameters, model }),
    serviceSchema: fixedServiceSchema(prefix),
    profileSchema,
    authentication: { methods: ['api-key'] },
    targets: () => ({ authentication: [], inference: [prefix], discovery: [`${prefix}/v1/models`] }),
    models: service => declaredModels(service, openCodeProtocols),
    discover: input => discoverModels(input, { endpoint: `${prefix}/v1/models`, format: 'openai', bearer: true }),
    createExecution(input) {
      const protocol = input.binding.model.protocol;
      const family = protocol === 'anthropic-messages' ? 'anthropic' : protocol === 'google-generate-content' ? 'google' : protocol === 'openai-chat' ? 'openai-compatible' : 'openai';
      const api = protocol === 'openai-responses' ? 'responses' : undefined;
      const baseUrl = `${prefix}/${family === 'openai-compatible' ? 'openai' : family}/${family === 'google' ? 'v1beta' : 'v1'}`;
      return sdkExecution({ ...input, binding: { ...input.binding, service: { ...input.binding.service, options: { baseUrl } } } }, {
        family, api, bearer: true, sessionHeader: 'x-opencode-session',
        headers: () => ({ 'user-agent': userAgent }),
      });
    },
  });
}

export const openCodeGoProvider = openCodeProvider('go');
export const openCodeZenProvider = openCodeProvider('zen');

declare module '@zhin.js/ai/provider' {
  interface AIProviderRegistry {
    'codex-subscription': typeof codexProvider;
    'claude-subscription': typeof claudeSubscriptionProvider;
    'opencode-go': typeof openCodeGoProvider;
    'opencode-zen': typeof openCodeZenProvider;
  }
}
