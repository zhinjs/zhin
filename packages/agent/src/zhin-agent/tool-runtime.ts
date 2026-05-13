import type { AgentTool } from '@zhin.js/ai';
import type { Tool, ToolContext } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { ZhinAgentConfig } from './config.js';
import { KEYWORD_TRIGGERS } from './config.js';
import {
  createChatHistoryTool,
  createSpawnTaskTool,
  createUserProfileTool,
} from './builtin-tools.js';
import type { ConversationMemory } from '@zhin.js/ai';
import type { UserProfileStore } from '../user-profile.js';
import type { SubagentManager } from '../subagent.js';
import { runPreExecutableTools, type PreExecuteResult } from './pre-exec.js';
import { sharedToolSelection } from '../orchestrator/tool-selection.js';

export interface CollectRuntimeToolsOptions {
  content: string;
  context: ToolContext;
  externalTools: Tool[];
  config: Required<ZhinAgentConfig>;
  skillRegistry: SkillRegistry | null;
  externalRegistered: Map<string, AgentTool>;
  sessionId: string;
  userId: string;
  memory: ConversationMemory;
  userProfiles: UserProfileStore;
  subagentManager: SubagentManager | null;
}

export function collectRuntimeTools(options: CollectRuntimeToolsOptions): AgentTool[] {
  const tools = sharedToolSelection.collectRelevantTools(options.content, options.context, options.externalTools, {
    config: options.config,
    skillRegistry: options.skillRegistry,
    externalRegistered: options.externalRegistered,
  });
  const names = new Set(tools.map(tool => tool.name));
  const add = (tool: AgentTool) => {
    if (names.has(tool.name)) return;
    tools.push(tool);
    names.add(tool.name);
  };

  if (KEYWORD_TRIGGERS.chatHistory.test(options.content)) {
    add(createChatHistoryTool(options.sessionId, options.memory));
  }
  if (KEYWORD_TRIGGERS.userProfile.test(options.content)) {
    add(createUserProfileTool(options.userId, options.userProfiles));
  }
  if (options.subagentManager && KEYWORD_TRIGGERS.spawnTask.test(options.content)) {
    add(createSpawnTaskTool(options.context, options.subagentManager));
  }

  return tools;
}

export interface ToolRunPlan {
  preExecTools: AgentTool[];
  preExecution: PreExecuteResult;
  hasNonPreExecTools: boolean;
  mode: 'chat' | 'pre-exec-fast-path' | 'agent';
}

export async function planToolRun(
  tools: AgentTool[],
  timeoutMs: number,
): Promise<ToolRunPlan> {
  const preExecution = await runPreExecutableTools(tools, timeoutMs);
  const hasNonPreExecTools = tools.some(tool => !tool.preExecutable);
  return {
    preExecTools: preExecution.tools,
    preExecution,
    hasNonPreExecTools,
    mode: tools.length === 0
      ? 'chat'
      : (!hasNonPreExecTools && preExecution.data ? 'pre-exec-fast-path' : 'agent'),
  };
}

export function buildPreExecFastPathPrompt(persona: string, preData: string): string {
  return `${persona}

Pre-fetched data (from user's question):
${preData}

Answer the user's question based on the data above. Be clear and concise; use emoji when appropriate.`;
}

