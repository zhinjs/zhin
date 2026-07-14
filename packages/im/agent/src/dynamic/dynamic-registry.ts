/**
 * defineDynamic turn overrides — tools / instructions (ADR 0039 P2).
 */
import type { Message } from '@zhin.js/core';
import type { AgentTool } from '@zhin.js/ai';
import type { AuthoringDynamicDefinition } from '../authoring/types.js';

export interface DynamicResolveContext {
  sessionId: string;
  userId: string;
  adapter: string;
  commMessage: Message;
  agentId?: string;
}

export interface DynamicResolveResult {
  additionalInstructions?: string;
  allowedToolNames?: string[];
  deniedToolNames?: string[];
}

export interface RegisteredDynamicResolver {
  pluginName: string;
  resolve: AuthoringDynamicDefinition['resolve'];
}

const resolvers: RegisteredDynamicResolver[] = [];

export function resetDynamicRegistryForTests(): void {
  resolvers.length = 0;
}

export function registerDynamicResolver(entry: RegisteredDynamicResolver): void {
  resolvers.push(entry);
}

export function listDynamicResolvers(): RegisteredDynamicResolver[] {
  return [...resolvers];
}

export interface AppliedDynamicTurnOverrides {
  tools: AgentTool[];
  additionalInstructions?: string;
}

export async function applyDynamicTurnOverrides(
  input: {
    tools: AgentTool[];
    ctx: DynamicResolveContext;
  },
): Promise<AppliedDynamicTurnOverrides> {
  if (!resolvers.length) {
    return { tools: input.tools };
  }

  const merged: DynamicResolveResult = {};
  for (const entry of resolvers) {
    const patch = await entry.resolve(input.ctx);
    if (!patch) continue;
    if (patch.additionalInstructions) {
      merged.additionalInstructions = merged.additionalInstructions
        ? `${merged.additionalInstructions}\n\n${patch.additionalInstructions}`
        : patch.additionalInstructions;
    }
    if (patch.allowedToolNames?.length) {
      merged.allowedToolNames = [...new Set([
        ...(merged.allowedToolNames ?? []),
        ...patch.allowedToolNames,
      ])];
    }
    if (patch.deniedToolNames?.length) {
      merged.deniedToolNames = [...new Set([
        ...(merged.deniedToolNames ?? []),
        ...patch.deniedToolNames,
      ])];
    }
  }

  let tools = input.tools;
  if (merged.allowedToolNames?.length) {
    const allow = new Set(merged.allowedToolNames);
    tools = tools.filter((t) => allow.has(t.name));
  }
  if (merged.deniedToolNames?.length) {
    const deny = new Set(merged.deniedToolNames);
    tools = tools.filter((t) => !deny.has(t.name));
  }

  return {
    tools,
    additionalInstructions: merged.additionalInstructions,
  };
}
