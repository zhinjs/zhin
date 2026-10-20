/**
 * Subagent System — SubagentSystem + ImResultSink（契约见 contracts.ts）。
 */

export type {
  SubagentDefinition,
  SubagentResult,
  Artifact,
  ResultSink,
  SubagentSystemConfig,
} from './contracts.js';

export {
  SubagentSystem,
  defaultSubagentSystem,
} from './subagent-system.js';

export type {
  SpawnOptions,
  SubagentCompletePayload,
  SubagentLifecycleEvent,
  SubagentOrigin,
  SubagentResultDelivery,
  SubagentResultSender,
  SubagentRuntimeOptions,
} from './subagent-system.js';

export {
  ImResultSink,
  createImResultSender,
} from './im-result-sink.js';
export type { ImResultSinkDeps } from './im-result-sink.js';

export { createSubagentSystem } from './subagent-system-init.js';
export type { SubagentSystemInitOptions } from './subagent-system-init.js';

export { SubagentRuntime } from './subagent-runtime.js';
