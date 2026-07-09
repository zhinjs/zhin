/**
 * Tool System — ToolSystem + Source + 运行时/延迟解析（契约见 contracts.ts）。
 */

export type {
  ToolSource,
  ToolFilter,
  ToolSystemConfig,
  TurnContext,
  FilterContext,
} from './contracts.js';

export type { ResolvedToolsForTurn } from './deferred-resolution.js';
export type { CollectToolsContext, CollectToolsForTurnInput } from './tool-system.js';
export type { CollectRuntimeToolsOptions, ToolRunPlan } from './runtime.js';

export {
  ToolSystem,
  defaultToolSystem,
  createToolSystem,
  createDefaultToolSources,
  planToolRun,
  buildPreExecFastPathPrompt,
} from './tool-system.js';

export {
  ExternalToolSource,
  SkillToolSource,
  RegisteredToolSource,
  BuiltinToolSource,
  McpToolSource,
  DedupeToolFilter,
} from './sources.js';

export {
  resolveAgentToolsForTurn,
  persistDeferredToolSnapshot,
  buildLlmToolsForProvider,
} from './deferred-resolution.js';

export { collectRuntimeTools } from './runtime.js';
export { prepareTurnTools } from './prepare-turn-tools.js';
export type { TurnToolsPrep } from './prepare-turn-tools.js';
