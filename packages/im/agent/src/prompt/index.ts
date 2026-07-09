/**
 * Prompt module — system prompt builders, assembly, workspace templates.
 */

export {
  resolveWorkspacePrompt,
  clearWorkspacePromptCache,
} from './workspace-prompt.js';
export type { WorkspacePromptRole } from './workspace-prompt.js';

export {
  FIXED_DISCIPLINE_RULES,
  contentToText,
  buildUserMessageWithHistory,
  buildEnhancedPersona,
  resolvePromptFileRole,
  buildContextHint,
  describePromptSectionsForDebug,
  buildRichSystemPrompt,
  buildRichSystemPromptWithBuilder,
  buildLiteSystemPromptWithPlatform,
  appendQuoteContextSystemHint,
} from './system-prompt.js';
export type { RichSystemPromptContext, PromptSectionDebugInfo } from './system-prompt.js';

export {
  buildDisciplinedPrompt,
  describeAgentPathPromptSections,
  buildAgentPathSystemPrompt,
  buildFastPathSystemPrompt,
  buildChatPathSystemPrompt,
  buildMultimodalVisionSystemPrompt,
  buildAgentUserMessage,
} from './assembly.js';

export * from './prompt-builder.js';
export * from './templates.js';
