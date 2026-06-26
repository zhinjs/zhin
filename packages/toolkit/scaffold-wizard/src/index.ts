export type { InitOptions, DatabaseConfig } from './types.js';
export { DATABASE_PACKAGES } from './types.js';

export type { AdapterSetupResult } from './adapter.js';
export {
  configureAdapters,
  generateAdapterEnvVars,
  generateEndpointsConfigYaml,
  generateEndpointsConfigJSON,
  generateEndpointsConfigToml,
  getAdapterDependencies,
  getAdapterSetupNotes,
} from './adapter.js';

export {
  ADAPTERS_DOCS_URL,
  ADAPTERS_INDEX_URL,
  ADAPTERS_ESSENTIALS_URL,
  adapterDocsUrl,
} from './adapter-configurers.js';

export type { AISetupConfig } from './ai.js';
export {
  configureAI,
  generateAIEnvVars,
  generateAIConfigYaml,
  generateAIConfigJSON,
  generateAIConfigToml,
  RECOMMENDED_AI_DEFAULTS,
} from './ai.js';

export { configureDatabaseOptions } from './database.js';

export {
  AI_STACK_VERSIONS,
  MCP_SDK_VERSION,
  getAIDependencies,
  listAIDependencyNames,
  formatAIDependencyHint,
  isAiEnabledInConfig,
  resolveDefaultProviderFromConfig,
  getRequiredAIDependenciesForConfig,
  diagnoseAIDependencies,
  formatAIDependencyFixCommand,
  packagesNeedingAiStackFix,
  findOutdatedAiStackInPackageJson,
  findInstalledAiStackIncompatibilities,
  ensureDatabaseForAI,
  ensureDatabaseForAdapters,
} from './project-deps.js';
export type { AiStackIncompatibility } from './project-deps.js';

export {
  ZHIN_STACK_VERSIONS,
  DEFAULT_CREATE_BOT_HTTP_PORT,
  CREATE_BOT_NPMRC,
  getCreateBotBaseDependencies,
  getCreateBotPnpmConfig,
  getRequiredZhinDependenciesForConfig,
  diagnoseZhinStackDependencies,
  formatZhinStackFixCommand,
  packagesNeedingZhinStackFix,
  findOutdatedZhinStackInPackageJson,
  findInstalledZhinStackIncompatibilities,
} from './zhin-stack-deps.js';
export type { ZhinStackDiagnosis, ZhinStackIncompatibility } from './zhin-stack-deps.js';

export {
  SPEECH_PACKAGE,
  HTML_RENDERER_PACKAGE,
  ADAPTERS_PREFER_HTML_IMAGE,
  diagnoseOptionalPeers,
  formatOptionalPeerFixCommand,
  getOptionalPeerDependencies,
} from './optional-peers.js';
export type { OptionalPeerDiagnosis, OptionalPeersDiagnosis } from './optional-peers.js';

export {
  diagnoseUpgradeToL4,
  getUpgradeToL4Dependencies,
} from './upgrade-l4.js';
export type { UpgradeToL4Diagnosis } from './upgrade-l4.js';

export {
  CONSOLE_HOST_PLUGINS,
  applyDatabaseToConfig,
  applyAdaptersToConfig,
  applyAIToConfig,
  appendWizardEnvVars,
  collectWizardDependencies,
  mergeDependenciesIntoPackageJson,
  finalizeWizardOptions,
  applyWizardOptionsToConfig,
} from './apply.js';
