/**
 * Orchestration runtime handle — Host API / A2A mesh 共享注册表。
 * Generation-scoped：provide 随 lifecycle 反注册，杜绝跨热重载悬挂。
 */
import {
  createGenerationStore,
  type Dispose,
  type GenerationStoreContext,
} from '@zhin.js/plugin-runtime';
import type { OrchestrationRunWithTasks } from './orchestrator/orchestration-repository.js';
import type { OrchestrationService } from './orchestrator/orchestration-service.js';

export interface OrchestrationRuntimeHandle {
  service: OrchestrationService;
  listRuns(sessionKey?: string): Promise<OrchestrationRunWithTasks[]>;
  getRun(runId: string): Promise<OrchestrationRunWithTasks | null>;
}

const store = createGenerationStore<OrchestrationRuntimeHandle>('zhin.agent.orchestration-runtime');

export function provideOrchestrationRuntime(
  context: GenerationStoreContext,
  handle: OrchestrationRuntimeHandle,
): Dispose {
  return store.provide(context, handle);
}

export function getOrchestrationRuntime(): OrchestrationRuntimeHandle | null {
  return store.tryUse() ?? null;
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
