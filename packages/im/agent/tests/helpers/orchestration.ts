/**
 * Test helper — create + provide an OrchestrationService for tests that rely on
 * `getOrchestrationService()` (生产路径的 provide 由 composition root 挂 lifecycle)。
 */
import { DisposeStack } from '@zhin.js/plugin-runtime';
import {
  createOrchestrationService,
  provideOrchestrationService,
  type OrchestrationService,
} from '../../src/orchestrator/orchestration-service.js';
import {
  MemoryOrchestrationRepository,
  type OrchestrationRepository,
} from '../../src/orchestrator/orchestration-repository.js';

export function provideTestOrchestrationService(
  repo: OrchestrationRepository = new MemoryOrchestrationRepository(),
): OrchestrationService {
  const service = createOrchestrationService(repo);
  provideOrchestrationService({ lifecycle: new DisposeStack() }, service);
  return service;
}
