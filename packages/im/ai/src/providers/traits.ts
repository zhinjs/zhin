import type { ModelDefinition, JsonObject } from '../provider/types.js';
import type { ProviderExecutionTraits } from '../provider/driver.js';
import { isLocalEndpoint } from '../llm/mid-conversation-system.js';
import type { StandardModelParameters, StandardServiceOptions } from './schema.js';
import type { SdkFamily } from './sdk-family.js';

/** Prompt capabilities follow the selected protocol and explicit metadata, not model-name guesses. */
export function executionTraits(input: Readonly<{
  family: SdkFamily; service: StandardServiceOptions; parameters: Pick<StandardModelParameters, 'maxRetries' | 'requestTimeoutMs'>; model: ModelDefinition; nativeDeferredTools?: boolean;
}>): ProviderExecutionTraits {
  const { family, service, model } = input;
  if (!model.kinds.includes('language')) return {};
  const midConversationSystem = service.compat?.midConversationSystem ?? (family === 'openai'
    ? model.thinking === true && service.compat?.supportsDeveloperRole !== false ? 'developer' : 'system'
    : family === 'openai-compatible' && !isLocalEndpoint(service.baseUrl) ? 'system' : 'none');
  const policy = input.parameters;
  return { promptFamily: family, midConversationSystem,
    executionPolicy: { ...(policy.maxRetries !== undefined ? { maxRetries: policy.maxRetries } : {}),
      ...(policy.requestTimeoutMs !== undefined ? { requestTimeoutMs: policy.requestTimeoutMs } : {}) },
    nativeDeferredTools: input.nativeDeferredTools === true && model.toolCalling === true };
}

/** Routing/authentication identity only; protocol rendering and cache tuning do not change it. */
export function serviceIdentity(input: Readonly<{ product: string; service: StandardServiceOptions; extra?: JsonObject }>): JsonObject {
  return { product: input.product, baseUrl: input.service.baseUrl,
    ...(input.service.authScheme !== undefined ? { authScheme: input.service.authScheme } : {}),
    ...(input.service.headers ? { headers: input.service.headers } : {}), ...input.extra };
}
