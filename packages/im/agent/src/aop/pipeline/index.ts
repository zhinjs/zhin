/**
 * Pipeline plane — Five-Agent 状态机 + artifact + 工具 + 上下文（ADR 0024）。
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
export {
  createPipelineTools,
  PIPELINE_TOOL_NAMES,
} from './pipeline-tools.js';
export { resolvePipelineTurnHint } from './pipeline-context.js';
export { detectPipelineProfile, cellHasFiveRoles } from './pipeline-mode.js';
export {
  isToolAllowedForRole,
  filterToolNamesForRole,
  filterToolsForRole,
  asPipelineRole,
} from './role-capability-policy.js';
