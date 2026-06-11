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
  MCP_SDK_VERSION,
  getAIDependencies,
  ensureDatabaseForAI,
  ensureDatabaseForAdapters,
} from './project-deps.js';

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
