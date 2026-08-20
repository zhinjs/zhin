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
  buildLiteSystemPromptWithPlatform,
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
} from './define-agent-prompt-section.js';
export type { AgentPromptSectionConfig } from './define-agent-prompt-section.js';

export {
  PromptSectionLoader,
} from './prompt-section-loader.js';
export type { PromptSectionLoaderOptions } from './prompt-section-loader.js';

export {
  discoverAndRegisterPromptSections,
  bootstrapPromptSections,
} from './discover-prompt-sections.js';

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
