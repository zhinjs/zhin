import { isReservedToolName, type AgentTool, type ImTranscriptStore, type MemoryImTranscriptStore } from '@zhin.js/ai';
import { canAccessTool, getLogger, type Tool as CoreTool } from '@zhin.js/core';
import type { PermissionHost } from '@zhin.js/permission';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { ZhinAgentConfig } from '../config/zhin-agent-config.js';
import { KEYWORD_TRIGGERS } from '../config/keyword-triggers.js';
import {
  createImTranscriptHistoryTool,
  createUserProfileTool,
} from '../tool/context-tools.js';
import type { UserProfileStore } from '../user-profile.js';
import { buildImTranscriptQuery } from '../session/session-io.js';
import { sharedToolSelection } from '../orchestrator/tool-selection.js';
import { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from '../reserved-tools.js';
import type { RegisteredAgentTool, ToolFilter, ToolSource } from './contracts.js';
const logger = getLogger('ToolSystem');

export interface CollectToolsContext {
  message: Message;
  content: string;
  sessionId: string;
  userId: string;
  config: Required<ZhinAgentConfig>;
  skillRegistry: SkillRegistry | null;
  externalTools: Tool[];
  externalRegistered: Map<string, RegisteredAgentTool>;
  imTranscriptStore: ImTranscriptStore | MemoryImTranscriptStore;
  userProfiles: UserProfileStore;
  mcpTools?: AgentTool[];
  /** PermissionHost（permit 声明的工具经其判定；缺省 fail-closed）。 */
  permissionHost?: PermissionHost | null;
}

export class ExternalToolSource implements ToolSource {
  name = 'external';
  priority = 200;

  constructor(private readonly externalTools: Tool[]) {}

  async collectTools(context: CollectToolsContext): Promise<AgentTool[]> {
    const tools: AgentTool[] = [];
    for (const tool of this.externalTools) {
      if (!(await canAccessTool(tool as unknown as CoreTool, context.message, context.permissionHost))) continue;
      tools.push(sharedToolSelection.normalize(tool, context.message));
    }
    return tools;
  }
}

export class SkillToolSource implements ToolSource {
  name = 'skills';
  priority = 100;

  constructor(private readonly skillRegistry: SkillRegistry | null) {}

  collectTools(context: CollectToolsContext): AgentTool[] {
    if (!this.skillRegistry) return [];
    return this.skillRegistry.collectAllTools().map((tool) =>
      sharedToolSelection.normalize(tool, context.message),
    );
  }
}

export class RegisteredToolSource implements ToolSource {
  name = 'registered';
  priority = 150;

  constructor(private readonly externalRegistered: Map<string, RegisteredAgentTool>) {}

  /**
   * Same per-message access predicate as {@link ExternalToolSource} — one
   * `canAccessTool` for both registration paths; `hidden` tools stay
   * executable by name but are never offered to the model.
   */
  async collectTools(context: CollectToolsContext): Promise<AgentTool[]> {
    const tools: AgentTool[] = [];
    for (const tool of this.externalRegistered.values()) {
      if (tool.hidden) continue;
      if (!(await canAccessTool(tool as unknown as CoreTool, context.message, context.permissionHost))) continue;
      tools.push(tool);
    }
    return tools;
  }
}

export class BuiltinToolSource implements ToolSource {
  name = 'builtin';
  priority = 1000;

  collectTools(context: CollectToolsContext): AgentTool[] {
    const tools: AgentTool[] = [];
    if (KEYWORD_TRIGGERS.chatHistory.test(context.content)) {
      tools.push(
        createImTranscriptHistoryTool(
          context.imTranscriptStore,
          buildImTranscriptQuery(context.message),
        ),
      );
    }
    if (KEYWORD_TRIGGERS.userProfile.test(context.content)) {
      tools.push(createUserProfileTool(context.userId, context.userProfiles));
    }
    return tools;
  }
}

export class McpToolSource implements ToolSource {
  name = 'mcp';
  priority = 50;

  collectTools(context: CollectToolsContext): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const mcpTool of context.mcpTools ?? []) {
      if (isReservedToolName(mcpTool.name, {
        reservedNames: RESERVED_TOOL_NAMES,
        reservedPrefixes: RESERVED_TOOL_NAME_PREFIXES,
      })) {
        logger.warn(`[MCP] Skipping tool "${mcpTool.name}": conflicts with reserved tool name`);
        continue;
      }
      tools.push(mcpTool);
    }
    return tools;
  }
}

export class PermissionToolFilter implements ToolFilter {
  name = 'permission';

  filter(tools: AgentTool[]): AgentTool[] {
    return tools;
  }
}

export class DedupeToolFilter implements ToolFilter {
  name = 'dedupe';

  filter(tools: AgentTool[]): AgentTool[] {
    const names = new Set<string>();
    const out: AgentTool[] = [];
    for (const tool of tools) {
      if (names.has(tool.name)) continue;
      out.push(tool);
      names.add(tool.name);
    }
    return out;
  }
}
