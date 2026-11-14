/**
 * Process and service status shapes shared by the gateway, the instance and the Console (#1250).
 */

/** One `process.memoryUsage()` call, in bytes: every field comes from the same process and instant. */
export interface ConsoleProcessMemory {
  readonly rss: number;
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly external?: number;
  readonly arrayBuffers?: number;
}

/**
 * A labeled resource sample of one process. The gateway and the supervised instance are separate
 * Node processes: never combine fields of two samples (e.g. the instance heap with the gateway RSS).
 * RSS can be below the heap on macOS (compressed memory) or with swap; that is not a mix-up.
 */
export interface ConsoleProcessSample {
  readonly role: 'gateway' | 'instance';
  readonly pid: number;
  /** Process uptime in seconds. */
  readonly uptime: number;
  readonly memory: ConsoleProcessMemory;
  /** Epoch milliseconds of the sample. */
  readonly sampledAt: number;
}

/** Why an MCP client is not connected; written by the Agent (#1250). */
export type ConsoleMcpFailureCategory =
  | 'auth' | 'network' | 'timeout' | 'config' | 'process_exit' | 'sdk_missing' | 'unknown';

export interface ConsoleMcpFailure {
  readonly category: ConsoleMcpFailureCategory;
  /** Short and redacted (no headers, env values, URL credentials or query strings); ≤ 200 chars. */
  readonly message: string;
  /** Exit code of a stdio server process that exited during start-up. */
  readonly exitCode?: number;
  /** Epoch milliseconds of the failed attempt. */
  readonly at: number;
}

/**
 * - `connected`: live connection;
 * - `failed`: last connect failed, see `lastError`;
 * - `idle`: loaded by the Agent, not connected yet (MCP connects lazily on first use);
 * - `not_loaded`: configured but not loaded by the running Agent.
 */
export type ConsoleMcpServerStatus = 'connected' | 'failed' | 'idle' | 'not_loaded';

/** Row of `GET {base}/introspection/mcp`. `status` / `lastError` are absent on older instances. */
export interface ConsoleMcpServerRow {
  readonly name: string;
  readonly connected: boolean;
  readonly toolCount: number;
  readonly transport?: string;
  readonly status?: ConsoleMcpServerStatus;
  readonly lastError?: ConsoleMcpFailure;
}
