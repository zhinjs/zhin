/**
 * Step checkpoint model — ADR 0040 P3 (HTTP session scope).
 */

export const AgentStepStatus = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  INTERRUPTED: 'interrupted',
} as const;

export type AgentStepStatusName = (typeof AgentStepStatus)[keyof typeof AgentStepStatus];

export type AgentStepInterruptKind = 'approval' | 'authorization' | 'unknown';

export interface AgentStepCheckpoint {
  stepId: string;
  turnId?: string;
  status: AgentStepStatusName;
  startedAt: number;
  completedAt?: number;
  interruptKind?: AgentStepInterruptKind;
  requestId?: string;
}

export function createStepId(): string {
  return `stp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
