import type { AgentTool } from '@zhin.js/ai';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { ZhinAgentConfig } from '../config/zhin-agent-config.js';
import type { ImTranscriptStore, MemoryImTranscriptStore } from '@zhin.js/ai';
import type { UserProfileStore } from '../user-profile.js';
import {
  createDefaultToolSources,
  defaultToolSystem,
  type CollectToolsContext,
  type ToolRunPlan,
  type ToolSystem,
} from './tool-system.js';

export interface CollectRuntimeToolsOptions {
  content: string;
  commMessage: Message;
  externalTools: Tool[];
  config: Required<ZhinAgentConfig>;
  skillRegistry: SkillRegistry | null;
  externalRegistered: Map<string, AgentTool>;
  sessionId: string;
  userId: string;
  imTranscriptStore: ImTranscriptStore | MemoryImTranscriptStore;
  userProfiles: UserProfileStore;
  mcpTools?: AgentTool[];
  toolSystem?: ToolSystem;
}

export function collectRuntimeTools(options: CollectRuntimeToolsOptions): AgentTool[] {
  const toolSystem = options.toolSystem ?? defaultToolSystem;
  const ctx: CollectToolsContext = {
    message: options.commMessage,
    content: options.content,
    sessionId: options.sessionId,
    userId: options.userId,
    config: options.config,
    skillRegistry: options.skillRegistry,
    externalTools: options.externalTools,
    externalRegistered: options.externalRegistered,
    imTranscriptStore: options.imTranscriptStore,
    userProfiles: options.userProfiles,
    mcpTools: options.mcpTools,
  };
  return toolSystem.collectTools(ctx, createDefaultToolSources(ctx));
}

export type { ToolRunPlan };
export { planToolRun, buildPreExecFastPathPrompt } from './tool-system.js';
