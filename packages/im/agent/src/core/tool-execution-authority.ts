import type { AgentTool } from '@zhin.js/ai';

export type AgentCoreToolExecutionOutcome =
  | Readonly<{ status: 'completed'; output: unknown; durationMs: number }>
  | Readonly<{ status: 'denied'; reason: string }>
  | Readonly<{ status: 'cancelled'; reason: string }>
  | Readonly<{ status: 'failed'; error: string; retryable: boolean }>;

/** Sole policy + approval + execution authority used by the full Agent Core. */
export interface ToolExecutionAuthority {
  execute(
    tool: AgentTool,
    input: Readonly<Record<string, unknown>>,
    toolUseId: string,
  ): Promise<AgentCoreToolExecutionOutcome>;
}
