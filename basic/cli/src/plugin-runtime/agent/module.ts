export {
  AgentRuntime,
  AgentTurnCoordinator,
  installAgentHost,
  type InstallAgentHostOptions,
} from './host-installer.js';
export {
  resolveAiConfig,
  resolveWorkroomStorageMode,
  resolveWorkroomTrustedPackPublishers,
} from './config.js';
export {
  isWorkroomPackageMissing,
  loadWorkroomHostModule,
  type WorkroomHostModule,
} from './workroom-loader.js';
export { createSelfChangeImpactPort } from './self-change-impact.js';
export { createSelfChangePluginRoots } from './self-change-plugin-roots.js';

export { HostInference } from '../inference/host.js';
export { registerInferenceRoutes } from '../inference/routes.js';
export { resolveInferenceManagementPrincipal } from '../inference/principal.js';
export { InferenceManagementError } from '../inference/management.js';
