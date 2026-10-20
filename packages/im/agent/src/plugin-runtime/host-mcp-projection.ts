import { defineMcp, mcpFeatureId, type McpDefinition } from '@zhin.js/mcp-feature';
import { McpClientConnection } from '../mcp-client/index.js';
import type { McpServerEntry } from '../resource-hub/types.js';

export interface HostMcpProjection {
  readonly feature: typeof mcpFeatureId;
  readonly name: string;
  readonly definition: Readonly<McpDefinition>;
}

/** Projects configured MCP transport into the generation activation lifecycle. */
export function projectHostMcp(entry: McpServerEntry): HostMcpProjection {
  if (!entry.name.trim()) throw new TypeError('Host MCP name cannot be empty');
  return Object.freeze({
    feature: mcpFeatureId,
    name: entry.name,
    definition: defineMcp({
      description: `Configured MCP server ${entry.name}`,
      create: () => {
        const connection = new McpClientConnection(entry);
        return {
          start: async (signal) => {
            signal.throwIfAborted();
            const connecting = connection.connect();
            let onAbort!: () => void;
            const abort = new Promise<never>((_resolve, reject) => {
              onAbort = () => {
                void connection.disconnect().finally(() => reject(
                  signal.reason ?? new Error(`Configured MCP server "${entry.name}" start aborted`),
                ));
              };
              signal.addEventListener('abort', onAbort, { once: true });
            });
            let state;
            try {
              state = await Promise.race([connecting, abort]);
            } finally {
              signal.removeEventListener('abort', onAbort);
            }
            if (!state.connected) {
              throw new Error(state.error || `Configured MCP server "${entry.name}" did not become ready`);
            }
          },
          stop: () => connection.disconnect(),
          listTools: () => connection.tools.map((tool) => Object.freeze({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters,
          })),
          callTool: (name, input) => connection.callTool(name, input as Record<string, unknown>),
        };
      },
    }),
  });
}
