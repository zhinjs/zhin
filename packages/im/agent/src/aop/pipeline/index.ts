/**
 * Pipeline plane — legacy cell.pipelineState + role ACL (ADR 0024, superseded by kernel).
 *
 * Model-facing cell_* pipeline tools were removed (ADR 0026/0027).
 * PipelineService remains for /collab reset and reading archived pipeline state.
 */
export * from './pipeline-transitions.js';
export * from './ports.js';
export {
  PipelineService,
  getPipelineService,
  setPipelineService,
  REVIEWER_ARTIFACT_WHITELIST,
  type PipelineServiceDeps,
  type EnsureStateOptions,
  type AdvanceResult,
} from './pipeline-service.js';
export { detectPipelineProfile, cellHasFiveRoles } from './pipeline-mode.js';
export {
  isToolAllowedForRole,
  filterToolNamesForRole,
  filterToolsForRole,
  asPipelineRole,
} from './role-capability-policy.js';
