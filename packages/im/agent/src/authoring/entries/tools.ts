export { defineAgentTool, defineTool } from '../define-tool.js';
export type {
  DefineAgentToolInput,
  DefineToolInput,
  AuthoringToolContext,
} from '../define-tool.js';
export {
  toolApprovalAlways,
  toolApprovalOnce,
  toolApprovalNever,
} from '../tool-policy.js';
export type { ToolApprovalPolicy, ToolToModelOutputFn } from '../tool-policy.js';
