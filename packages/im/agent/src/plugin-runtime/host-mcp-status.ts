import { McpClientConnection } from '../mcp-client/index.js';
import { classifyMcpFailure, McpConnectionError, type McpConnectionFailure } from '../mcp-client/failure.js';
import type { McpServerEntry } from '../resource-hub/types.js';
import type { AgentHostMcpSummary } from './agent-host-port.js';

/**
 * Connection state of the configured MCP servers (`ai.mcpServers`, #1250).
 *
 * Under the Plugin Runtime the configured servers are generation-owned MCP features
 * ({@link projectHostMcp}): their clients connect when the generation is activated, not in the
 * Agent's `resourceHub.mcps` registry. That registry stayed empty, so introspection reported every
 * configured server as "not loaded" although the Agent had connected it. The board records what the
 * projected clients actually did, across generations (a retained generation keeps its clients).
 */
export type HostMcpStatusEvent =
  | Readonly<{ type: 'connecting'; name: string }>
  | Readonly<{ type: 'connected'; name: string; toolCount: number }>
  | Readonly<{ type: 'failed'; name: string; failure: McpConnectionFailure }>;

export interface HostMcpStatusBoardOptions {
  /** Called on every connect attempt and its outcome (logging). */
  readonly onEvent?: (event: HostMcpStatusEvent) => void;
}

/** Outcome of {@link HostMcpStatusBoard.probe}: a throw-away connection, closed again right away. */
export type HostMcpProbeResult =
  | Readonly<{ ok: true; name: string; toolCount: number; durationMs: number }>
  | Readonly<{ ok: false; name: string; failure: McpConnectionFailure; durationMs: number }>;

export const DEFAULT_MCP_PROBE_TIMEOUT_MS = 15_000;

export class HostMcpStatusBoard {
  readonly #live = new Map<string, Set<McpClientConnection>>();
  readonly #failures = new Map<string, McpConnectionFailure>();
  readonly #onEvent?: (event: HostMcpStatusEvent) => void;

  constructor(options: HostMcpStatusBoardOptions = {}) {
    this.#onEvent = options.onEvent;
  }

  /** A projected client starts connecting; it counts until {@link release}. */
  track(name: string, connection: McpClientConnection): void {
    let live = this.#live.get(name);
    if (!live) this.#live.set(name, live = new Set());
    live.add(connection);
    this.#emit({ type: 'connecting', name });
  }

  /** The client stopped (generation disposed, or its start failed). */
  release(name: string, connection: McpClientConnection): void {
    const live = this.#live.get(name);
    live?.delete(connection);
    if (live?.size === 0) this.#live.delete(name);
  }

  connected(name: string, connection: McpClientConnection): void {
    this.#failures.delete(name);
    this.#emit({ type: 'connected', name, toolCount: connection.tools.length });
  }

  failed(name: string, failure: McpConnectionFailure): void {
    this.#failures.set(name, failure);
    this.#emit({ type: 'failed', name, failure });
  }

  /**
   * Row for one configured server: `connected` while any live client is connected; otherwise the
   * last failed connect, if any. Neither means it has not connected yet (pending first use).
   */
  summary(name: string): AgentHostMcpSummary {
    const connected = [...this.#live.get(name) ?? []].filter(connection => connection.isConnected);
    if (connected.length > 0) {
      return Object.freeze({ name, connected: true, toolCount: Math.max(...connected.map(connection => connection.tools.length)) });
    }
    const lastError = this.#failures.get(name);
    return Object.freeze({ name, connected: false, toolCount: 0, ...(lastError ? { lastError } : {}) });
  }

  /**
   * Connects to `entry` once with a fresh client, lists its tools and disconnects. It does not
   * change the Agent's own clients or the recorded state; the Console "test connection" action.
   */
  async probe(entry: McpServerEntry, timeoutMs = DEFAULT_MCP_PROBE_TIMEOUT_MS): Promise<HostMcpProbeResult> {
    const started = Date.now();
    const connection = new McpClientConnection(entry);
    const connecting = connection.connect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new McpProbeTimeoutError(timeoutMs)), timeoutMs);
    });
    try {
      const state = await Promise.race([connecting, timeout]);
      if (!state.connected) {
        return Object.freeze({
          ok: false as const, name: entry.name, durationMs: Date.now() - started,
          failure: connection.failure ?? classifyMcpFailure(new Error(state.error || 'MCP server did not become ready'), entry),
        });
      }
      return Object.freeze({ ok: true as const, name: entry.name, toolCount: connection.tools.length, durationMs: Date.now() - started });
    } catch (error) {
      const failure = error instanceof McpConnectionError
        ? error.failure
        : error instanceof McpProbeTimeoutError
          ? Object.freeze({ category: 'timeout' as const, message: error.message, at: Date.now() })
          : connection.failure ?? classifyMcpFailure(error, entry);
      return Object.freeze({ ok: false as const, name: entry.name, failure, durationMs: Date.now() - started });
    } finally {
      clearTimeout(timer);
      // A connect still running after the deadline is closed once it settles.
      void connecting.then(() => connection.disconnect(), () => undefined);
      await connection.disconnect();
    }
  }

  #emit(event: HostMcpStatusEvent): void {
    try { this.#onEvent?.(event); } catch { /* logging must not break connections */ }
  }
}

class McpProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`MCP connection did not complete within ${timeoutMs}ms`);
    this.name = 'McpProbeTimeoutError';
  }
}
