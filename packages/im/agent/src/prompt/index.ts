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
  buildUserMessageWithHistory,
  describePromptSectionsForDebug,
  buildRichSystemPrompt,
  buildLiteSystemPrompt,
  createDefaultPromptAssemblyRegistry,
  enforcePromptBudget,
} from './system-prompt.js';
export type { RichSystemPromptContext, PromptSectionDebugInfo } from './system-prompt.js';
export {
  PromptAssemblyRegistry,
} from './prompt-assembly-registry.js';
export type {
  PromptAssemblyEntry,
  PromptAssemblySection,
  PromptSectionRegistry,
} from './prompt-assembly-registry.js';
export { promptAssemblyToken } from './tokens.js';
export type { PromptAssemblyToken, PromptAssemblyResource } from './tokens.js';
export type { AgentPromptProfile } from './turn-prompt-profile.js';

export {
  defineAgentPromptSection,
  isPromptSectionIndex,
  PromptSectionIndex,
  promptSectionFeatureId,
} from '@zhin.js/prompt-section';
export type {
  AgentPromptSectionDefinition,
  AgentPromptSectionInput,
  PromptProfile,
  PromptSectionDescriptor,
  PromptSectionLayer,
  PromptSectionRetention,
} from '@zhin.js/prompt-section';

export {
  buildDisciplinedPrompt,
  describeAgentPathPromptSections,
  buildAgentPathSystemPrompt,
  buildChatPathSystemPrompt,
  buildMultimodalVisionSystemPrompt,
  buildAgentUserMessage,
} from './assembly.js';

export * from './prompt-builder.js';
export * from './templates.js';
