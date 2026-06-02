/**
 * Owner 硬编排（ZHIN_NEEDS_OWNER → ask_user）涉及的工具白名单。
 */
export const OWNER_HARD_ORCHESTRATION_TOOLS = [
  'bash',
  'write_file',
  'edit_file',
  'web_fetch',
] as const;

export type OwnerHardOrchestrationTool = (typeof OWNER_HARD_ORCHESTRATION_TOOLS)[number];
