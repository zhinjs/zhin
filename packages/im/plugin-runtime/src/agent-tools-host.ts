import { createToken } from './token.js';

/**
 * Plugin-contributed Agent tool registered against the Agent Host.
 * Captured at setup() time — execute closures must never call plugin locators.
 *
 * Access vocabulary (platforms / scopes / permissions / hidden) mirrors the
 * `@zhin.js/tool` ToolIndex descriptor and is enforced per message by the
 * Agent runtime via Core `canAccessTool` — one predicate for both paths.
 */
export interface AgentToolRegistration {
  /** Runtime tool name exposed to the model (e.g. `lottery_sync`). */
  readonly name: string;
  readonly description: string;
  /** zod object schema or JSON Schema; drives the deferred catalog + arg validation. */
  readonly inputSchema?: unknown;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  /** Limit to these adapter platforms (e.g. `['icqq']`); empty = all. */
  readonly platforms?: readonly string[];
  /** Limit to these channel scopes; empty = all. */
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
  readonly permissions?: readonly string[];
  /** Registered but never offered to the model (callable by name only). */
  readonly hidden?: boolean;
  /** Per-tool approval policy; stacks with ExecPolicy. */
  readonly approval?: 'never' | 'always';
  /** Plugin/tool origin label (e.g. plugin name) for diagnostics. */
  readonly source?: string;
  execute(input: Record<string, unknown>): unknown | Promise<unknown>;
}

/**
 * Generation-owned Agent tool registry provided by the Agent Host.
 * Absent when AI is not installed/enabled — plugins must guard with `has()`.
 */
export interface AgentToolsHost {
  /** Register a tool for every Agent turn of this generation; returns disposal. */
  register(tool: AgentToolRegistration): () => void;
}

export const agentToolsHostToken = createToken<AgentToolsHost>(
  'zhin.agent-tools.host',
  'Plugin Runtime agent tools host',
);
