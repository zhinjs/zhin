/**
 * MCP Tool/Resource/Prompt → AgentTool bridge
 *
 * Converts MCP server capabilities into Zhin's AgentTool format
 * so they can be seamlessly registered in the ToolRegistry.
 */

import type { AgentTool, JsonSchema } from '@zhin.js/ai';
import { formatMcpQualifiedToolName } from '@zhin.js/ai/mcp-qualified-name';
import type { McpResource, McpPrompt } from '../orchestrator/types.js';

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export function mcpToolToAgentTool(
  mcpTool: McpToolDefinition,
  serverName: string,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): AgentTool {
  const parameters: JsonSchema = {
    type: 'object',
    properties: mcpTool.inputSchema?.properties as Record<string, JsonSchema> ?? {},
    required: mcpTool.inputSchema?.required,
  };

  return {
    name: formatMcpQualifiedToolName(serverName, mcpTool.name),
    description: mcpTool.description ?? `MCP tool from ${serverName}`,
    parameters,
    execute: async (args) => callTool(mcpTool.name, args),
    tags: ['mcp', serverName],
    kind: 'mcp',
    source: `mcp:${serverName}`,
    isReadOnly: false,
  };
}

export function mcpResourceToInfo(resource: McpResource): McpResource {
  return {
    uri: resource.uri,
    name: resource.name ?? resource.uri,
    description: resource.description,
    mimeType: resource.mimeType,
  };
}

export function mcpPromptToInfo(prompt: McpPrompt): McpPrompt {
  return {
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments,
  };
}
