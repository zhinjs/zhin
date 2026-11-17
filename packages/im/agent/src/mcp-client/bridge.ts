/**
 * MCP Tool/Resource/Prompt → AgentTool bridge
 *
 * Converts MCP server capabilities into the model-facing AgentTool format.
 */

import type { AgentTool, JsonSchema } from '@zhin.js/ai';
import { formatMcpQualifiedToolName } from '@zhin.js/ai/mcp-qualified-name';
import { mcpToolHintsFromAnnotations, type McpToolHints } from '@zhin.js/mcp-feature';
import type { McpResource, McpPrompt } from '../resource-hub/types.js';

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  /** Upstream `tools/list` annotations; read through {@link mcpToolHintsFromAnnotations} (ADR 0065 D1). */
  annotations?: unknown;
}

/** Where a bridged MCP tool came from: the server, the upstream (unprefixed) tool name and its hints. */
export interface McpAgentToolOrigin {
  readonly server: string;
  readonly tool: string;
  readonly hints?: McpToolHints;
}

export type McpAgentTool = AgentTool & { readonly mcpOrigin?: McpAgentToolOrigin };

export function mcpToolToAgentTool(
  mcpTool: McpToolDefinition,
  serverName: string,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): McpAgentTool {
  const hints = mcpToolHintsFromAnnotations(mcpTool.annotations);
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
    // Upstream hints never relax approval (ADR 0065 D1.3): the bridged tool stays "may write".
    isReadOnly: false,
    mcpOrigin: Object.freeze({
      server: serverName,
      tool: mcpTool.name,
      ...(hints ? { hints } : {}),
    }),
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
