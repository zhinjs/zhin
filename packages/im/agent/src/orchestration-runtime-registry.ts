/**
 * Orchestration runtime — Host API / MCP Mesh 共用（Agent Mesh v1）。
 */
import type { OrchestrationRunWithTasks } from './orchestrator/orchestration-repository.js';
import type { OrchestrationService } from './orchestrator/orchestration-service.js';

export interface OrchestrationRuntimeHandle {
  service: OrchestrationService;
  listRuns(sessionKey?: string): Promise<OrchestrationRunWithTasks[]>;
  getRun(runId: string): Promise<OrchestrationRunWithTasks | null>;
}

let runtime: OrchestrationRuntimeHandle | null = null;

export function resetOrchestrationRuntime(): void { runtime = null; }

export function setOrchestrationRuntime(handle: OrchestrationRuntimeHandle | null): void {
  runtime = handle;
}

export function getOrchestrationRuntime(): OrchestrationRuntimeHandle | null {
  return runtime;
}

export function createOrchestrationRuntimeFromService(
  service: OrchestrationService,
): OrchestrationRuntimeHandle {
  return {
    service,
    listRuns: (sessionKey) => service.listRuns(sessionKey),
    getRun: (runId) => service.getStatus(runId),
  };
}
