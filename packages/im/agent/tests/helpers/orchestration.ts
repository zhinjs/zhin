/** Test helper for explicitly owned OrchestrationService instances. */
import {
  createOrchestrationService,
  type OrchestrationService,
} from '../../src/orchestrator/orchestration-service.js';
import {
  MemoryOrchestrationRepository,
  type OrchestrationRepository,
} from '../../src/orchestrator/orchestration-repository.js';

export function createTestOrchestrationService(
  repo: OrchestrationRepository = new MemoryOrchestrationRepository(),
): OrchestrationService {
  const service = createOrchestrationService(repo);
  return service;
}
