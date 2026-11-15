import { defineMcp, mcpFeatureId, type McpDefinition } from '@zhin.js/mcp-feature';
import { McpClientConnection } from '../mcp-client/index.js';
import { classifyMcpFailure, McpConnectionError } from '../mcp-client/failure.js';
import type { McpServerEntry } from '../resource-hub/types.js';
import type { HostMcpStatusBoard } from './host-mcp-status.js';

export interface HostMcpProjection {
  readonly feature: typeof mcpFeatureId;
  readonly name: string;
  readonly definition: Readonly<McpDefinition>;
}

/**
 * Projects configured MCP transport into the generation activation lifecycle. `status` records
 * each client's connect outcome for introspection (#1250).
 */
export function projectHostMcp(entry: McpServerEntry, status?: HostMcpStatusBoard): HostMcpProjection {
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
            status?.track(entry.name, connection);
            try {
              await startConnection(signal);
            } catch (error) {
              status?.release(entry.name, connection);
              // A cancelled generation is not a failed connect.
              if (!signal.aborted) {
                status?.failed(entry.name, error instanceof McpConnectionError
                  ? error.failure
                  : connection.failure ?? classifyMcpFailure(error, entry));
              }
              throw error;
            }
            status?.connected(entry.name, connection);
          },
          stop: () => {
            status?.release(entry.name, connection);
            return connection.disconnect();
          },
          listTools: () => connection.tools.map((tool) => Object.freeze({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters,
          })),
          callTool: (name, input) => connection.callTool(name, input as Record<string, unknown>),
        };
        async function startConnection(signal: AbortSignal): Promise<void> {
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
        }
      },
    }),
  });
}
