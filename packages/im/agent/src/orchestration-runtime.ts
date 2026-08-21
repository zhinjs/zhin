import type { OrchestrationRunWithTasks } from './orchestrator/orchestration-repository.js';
import type { OrchestrationService } from './orchestrator/orchestration-service.js';

/** Generation-owned orchestration projection exposed through AgentHostPort. */
export interface OrchestrationRuntimeHandle {
  listRuns(sessionKey?: string): Promise<OrchestrationRunWithTasks[]>;
  getRun(runId: string): Promise<OrchestrationRunWithTasks | null>;
}

export function createOrchestrationRuntimeFromService(
  service: OrchestrationService,
): OrchestrationRuntimeHandle {
  return {
    listRuns: (sessionKey) => service.listRuns(sessionKey),
    getRun: (runId) => service.getStatus(runId),
  };
}
