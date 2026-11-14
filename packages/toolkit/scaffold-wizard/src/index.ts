export { wizardText } from './messages.js';
export type { InitOptions, DatabaseConfig } from './types.js';
export { configureProjectLocale, validateProjectLocale, readProjectLocaleArgument } from './locale.js';
export { DATABASE_DRIVER_VERSIONS, DATABASE_PACKAGES } from './types.js';
export {
  DATABASE_DIALECT_DEFINITIONS,
  databaseChoiceLabel,
  getDatabaseDialectDefinition,
  validateDatabaseConfig,
} from './database-definitions.js';
export type {
  DatabaseDialect,
  DatabaseDialectDefinition,
  DatabaseDriverDefinition,
  DatabaseSchemaIssue,
} from './database-definitions.js';

export type { AdapterSetupResult, AdapterPluginInstance, AdapterDefinition } from './adapter.js';
export {
  ADAPTERS,
  findAdapterByPackage,
  configureAdapters,
  buildDefaultAdapterSetup,
  buildFieldBasedInstanceConfig,
  generateAdapterEnvVars,
  collectAdapterPluginConfigs,
  collectAdapterPluginManifest,
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
  RECOMMENDED_AI_DEFAULTS,
} from './ai.js';

export { configureDatabaseOptions } from './database.js';

export {
  formatEnvValue,
  mergeEnvText,
  generateDatabaseEnvExample,
  generateDatabaseEnvVars,
} from './env.js';

export {
  AI_STACK_VERSIONS,
  MCP_SDK_VERSION,
  getAIDependencies,
  listAIDependencyNames,
  formatAIDependencyHint,
  isAiEnabledInConfig,
  resolveAgentProviderFromPlan,
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
  FALLBACK_DEPENDENCY_RANGE,
  scaffoldDependencyRange,
  withScaffoldVersionRanges,
} from './stack-version-ranges.js';
export type { StackVersionRanges } from './stack-version-ranges.js';

export {
  ZHIN_STACK_VERSIONS,
  DEFAULT_CREATE_BOT_HTTP_PORT,
  CREATE_BOT_PACKAGE_MANAGER,
  GATEWAY_NATIVE_BUILD_DEPENDENCIES,
  getCreateBotBaseDependencies,
  getCreateBotPnpmWorkspaceConfig,
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
  loadProjectConfig,
  createProjectConfigPlan,
  renderProjectConfigPatch,
  applyProjectConfigPlan,
  diagnoseConsoleConfig,
  applyConsoleConfigFixes,
  packageToInstanceKey,
} from './project-config-plan.js';
export type {
  LoadedProjectConfig,
  ProjectConfigFormat,
  ProjectConfigPlan,
  ProjectConfigPlanOptions,
  ConsoleConfigDiagnosis,
} from './project-config-plan.js';

export {
  applyDatabaseToConfig,
  applyAdaptersToConfig,
  applyAIToConfig,
  appendWizardEnvVars, readAIPlanProposal, saveAIPlanProposal, mergeAIPlanProposals,
  collectWizardDependencies,
  collectWizardFeatures,
  mergeDependenciesIntoPackageJson,
  mergeFeaturesIntoPackageJson,
  finalizeWizardOptions,
  applyWizardOptionsToConfig,
  clonePluginConfigurationMap,
  materializeDatabaseConfig,
  buildRuntimeConfigDocument,
  serializeRuntimeConfig,
} from './apply.js';

export {
  TYPESAFE_DECISION_PACKAGE, configureTypeSafeDecisions, applyTypeSafeDecisionsToConfig,
  saveTypeSafeSetupDependencies, diagnoseDecisionConfig,
} from './decisions.js';
export type { TypeSafeSetupConfig } from './decisions.js';

export { materializeAIConfig, materializeAIPlan } from './ai.js';
