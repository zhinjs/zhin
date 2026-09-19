/**
 * Tool selection — normalization, permission checks, context injection and relevance caching.
 */

import { canAccessTool as coreCanAccessTool, resolveContextKey, type Message } from '@zhin.js/core';
import type { PermissionHost } from '@zhin.js/permission';
import type { AgentTool } from '@zhin.js/ai';
import type { Tool } from './types.js';

export type NormalizableTool = Tool | AgentTool;

export const DEFAULT_SUBAGENT_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob',
  'grep',
  'bash',
  'web_search',
  'web_fetch',
  'generate_image',
  'knowledge_search',
] as const;

export async function canAccessTool(tool: Tool, message?: Message, host?: PermissionHost | null): Promise<boolean> {
  return coreCanAccessTool(tool as import('@zhin.js/core').Tool, message, host);
}

function hasToolShape(input: unknown): input is Tool {
  const obj = input as Partial<Tool> | undefined;
  return !!obj
    && typeof obj.name === 'string'
    && typeof obj.description === 'string'
    && typeof obj.execute === 'function'
    && !!obj.parameters;
}

function isIMTool(input: unknown): input is Tool {
  if (!hasToolShape(input)) return false;
  const obj = input as Partial<Tool>;
  return 'platforms' in obj
    || 'scopes' in obj
    || 'permissions' in obj
    || 'hidden' in obj
    || 'source' in obj;
}

function stripContextParameters(tool: Tool, message?: Message): {
  parameters: AgentTool['parameters'];
  injections: Array<{ paramName: string; contextKey: string; paramType: string }>;
} {
  const injections: Array<{ paramName: string; contextKey: string; paramType: string }> = [];
  let parameters: AgentTool['parameters'] = tool.parameters;

  if (!message || !tool.parameters?.properties) {
    return { parameters, injections };
  }

  const props = tool.parameters.properties as Record<string, any>;
  const filteredProps: Record<string, any> = {};
  const filteredRequired: string[] = [];

  for (const [key, schema] of Object.entries(props)) {
    if (schema.contextKey && resolveContextKey(message, schema.contextKey) != null) {
      injections.push({
        paramName: key,
        contextKey: schema.contextKey,
        paramType: schema.type || 'string',
      });
      continue;
    }
    filteredProps[key] = schema;
    if (tool.parameters.required?.includes(key)) {
      filteredRequired.push(key);
    }
  }

  if (injections.length > 0) {
    parameters = {
      ...tool.parameters,
      properties: filteredProps,
      required: filteredRequired.length > 0 ? filteredRequired : undefined,
    };
  }

  return { parameters, injections };
}

export function normalizeTool(input: NormalizableTool, message?: Message): AgentTool {
  if (!isIMTool(input) && !(message && hasToolShape(input))) {
    return input as AgentTool;
  }

  const tool = input;
  const originalExecute = tool.execute;
  const { parameters, injections } = stripContextParameters(tool, message);

  const agentTool: AgentTool = {
    name: tool.name,
    description: tool.description,
    parameters,
    execute: message
      ? async (args: Record<string, any>) => {
          const enrichedArgs = { ...args };
          for (const { paramName, contextKey, paramType } of injections) {
            let value = resolveContextKey(message, contextKey);
            if (paramType === 'number' && typeof value === 'string') {
              value = Number(value);
            } else if (paramType === 'string' && typeof value !== 'string') {
              value = String(value);
            }
            enrichedArgs[paramName] = value;
          }
          return originalExecute(enrichedArgs, message);
        }
      : async (args: Record<string, any>) => originalExecute(args),
  };

  if (tool.tags?.length) agentTool.tags = tool.tags;
  if (tool.keywords?.length) agentTool.keywords = tool.keywords;
  if (tool.permissions?.length) agentTool.permissions = [...tool.permissions];
  if (tool.preExecutable) agentTool.preExecutable = true;
  if (tool.kind) agentTool.kind = tool.kind;
  if (tool.source) agentTool.source = tool.source;
  if (tool.approval) agentTool.approval = tool.approval;
  if (tool.toModelOutput) agentTool.toModelOutput = tool.toModelOutput;
  const toolTimeout = (tool as { timeout?: number }).timeout;
  if (toolTimeout != null) agentTool.timeout = toolTimeout;
  const toolGeneration = (tool as { generation?: number }).generation;
  if (toolGeneration != null) agentTool.generation = toolGeneration;
  return agentTool;
}
