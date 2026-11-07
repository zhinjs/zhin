export { openAiProvider, anthropicProvider, googleProvider, deepSeekProvider, miniMaxProvider,
  ollamaProvider, openAiCompatibleProvider, cloudflareProvider } from './api-key.js';
export { codexProvider, claudeSubscriptionProvider, openCodeGoProvider, openCodeZenProvider } from './subscriptions.js';
export { antigravityProvider } from './antigravity.js';
export { ProviderAuthenticationError, ProviderPreparationError } from './oauth.js';
export { ProviderProtocolError } from './errors.js';
export {
  MODEL_CAPABILITY_CATALOG,
  inferModelCapabilities,
  inferDefaultModelInput,
  applyModelCapabilityDefaults,
  type ModelCapabilityBaseline,
  type ModelCapabilityCatalogEntry,
  type InferModelCapabilitiesInput,
} from './model-capability-catalog.js';

import { openAiProvider, anthropicProvider, googleProvider, deepSeekProvider, miniMaxProvider, ollamaProvider, openAiCompatibleProvider, cloudflareProvider } from './api-key.js';
import { codexProvider, claudeSubscriptionProvider, openCodeGoProvider, openCodeZenProvider } from './subscriptions.js';
import { antigravityProvider } from './antigravity.js';

/** Installed by the optional AI Host in its single setup declaration. No clients or credentials. */
export const builtinAiProviders = Object.freeze([
  openAiProvider, anthropicProvider, googleProvider, deepSeekProvider, miniMaxProvider,
  ollamaProvider, openAiCompatibleProvider, cloudflareProvider, codexProvider,
  claudeSubscriptionProvider, openCodeGoProvider, openCodeZenProvider, antigravityProvider,
]);
