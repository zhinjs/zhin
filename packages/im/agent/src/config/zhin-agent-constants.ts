import {
  DEFAULT_ALWAYS_LOADED_TOOLS,
} from '../tool-catalog/types.js';

export const SECTION_SEP = '\n\n---\n\n';
export const HISTORY_CONTEXT_MARKER = '[Chat messages since your last reply - for context]';
/** 与 @zhin.js/core `CURRENT_USER_MESSAGE_MARKER` 保持一致 */
export const CURRENT_MESSAGE_MARKER = '[Current message - respond to this]';

export { KEYWORD_TRIGGERS } from './keyword-triggers.js';

/** 硬编排 v1 追加的总监工具 */
export const HARD_ORCHESTRATION_TOOLS = [
  'orchestration_start',
  'orchestration_add_task',
  'orchestration_status',
  'orchestration_complete',
  'orchestration_retry_task',
  'orchestration_skip_task',
] as const;

export const DEFAULT_HARD_ORCHESTRATOR_TOOLS = [
  ...DEFAULT_ALWAYS_LOADED_TOOLS,
  ...HARD_ORCHESTRATION_TOOLS,
] as const;

/** Deferred Worker 默认基础工具 */
export const DEFAULT_WORKER_BASE_TOOLS = [
  'bash',
  'read_file',
  'web_search',
] as const;
