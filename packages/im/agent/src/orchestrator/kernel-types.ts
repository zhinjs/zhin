/**
 * Agent Run orchestration kernel public contracts.
 */
import type {
  OrchestrationExecutorKind,
  OrchestrationRunSource,
  OrchestrationRunStatus,
  OrchestrationTaskStatus,
} from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import type { AgentRole } from './agent-dispatcher.js';

export type RunStatus = OrchestrationRunStatus;
export type TaskStatus = OrchestrationTaskStatus;
export type ExecutorKind = OrchestrationExecutorKind;

export interface OrchestrationRun {
  id: string;
  sessionKey: string;
  status: RunStatus;
  title: string;
  source?: OrchestrationRunSource;
  createdAt: number;
  updatedAt: number;
}

export interface OrchestrationTask {
  id: string;
  runId: string;
  name: string;
  description: string;
  role: AgentRole;
  goal: string;
  status: TaskStatus;
  dependsOn: string[];
  executorKind: ExecutorKind;
  assignedTo?: string;
  remoteAgentId?: string;
  resultSummary?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RunEvent {
  id: string;
  runId: string;
  taskId?: string;
  type:
    | 'run.started'
    | 'run.status_changed'
    | 'task.created'
    | 'task.assigned'
    | 'task.started'
    | 'task.thinking'
    | 'task.progress'
    | 'task.completed'
    | 'task.failed'
    | 'result.returned';
  seq: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface RunSnapshot {
  run: OrchestrationRun;
  tasks: OrchestrationTask[];
  events: RunEvent[];
}

export interface AgentExecutionEvent {
  type: 'thinking' | 'progress' | 'result' | 'error';
  text?: string;
  result?: string;
  error?: string;
}

export interface AgentExecutorInput {
  run: OrchestrationRun;
  task: OrchestrationTask;
  message?: Message;
  signal?: AbortSignal;
}

export interface AgentExecutor {
  readonly kind: ExecutorKind;
  execute(input: AgentExecutorInput): AsyncIterable<AgentExecutionEvent>;
}

export interface WorkflowStrategyInput {
  run: OrchestrationRun;
  goal: string;
  message?: Message;
}

export interface WorkflowTaskSpec {
  /** Stable strategy-local key. Other specs may reference it in dependsOn. */
  key?: string;
  name: string;
  description?: string;
  role?: AgentRole;
  goal?: string;
  dependsOn?: string[];
  executorKind?: ExecutorKind;
  assignedTo?: string;
  context?: Record<string, unknown>;
}

export interface WorkflowStrategy {
  readonly name: string;
  plan(input: WorkflowStrategyInput): Promise<WorkflowTaskSpec[]> | WorkflowTaskSpec[];
}
