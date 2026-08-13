import { describe, expect, it } from 'vitest';
import { DisposeStack } from '@zhin.js/plugin-runtime';
import {
  getAssistantRuntime,
  provideAssistantRuntime,
} from '../src/assistant/runtime-registry.js';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  getOrchestrationService,
  OrchestrationService,
  provideOrchestrationService,
} from '../src/orchestrator/orchestration-service.js';

describe('generation-owned Agent runtime registrations', () => {
  it('lets a disabled generation override and then reveal the previous Assistant', async () => {
    const previous = { id: 'previous' } as never;
    const genPrevious = new DisposeStack();
    const genNext = new DisposeStack();
    provideAssistantRuntime({ lifecycle: genPrevious }, previous);
    provideAssistantRuntime({ lifecycle: genNext }, null);

    expect(getAssistantRuntime()).toBeNull();
    await genNext.dispose();
    expect(getAssistantRuntime()).toBe(previous);
    await genPrevious.dispose();
    expect(getAssistantRuntime()).toBeNull();
  });

  it('keeps orchestration bound to the newest live generation', async () => {
    const previous = new OrchestrationService(new MemoryOrchestrationRepository());
    const next = new OrchestrationService(new MemoryOrchestrationRepository());
    const genPrevious = new DisposeStack();
    const genNext = new DisposeStack();
    provideOrchestrationService({ lifecycle: genPrevious }, previous);
    provideOrchestrationService({ lifecycle: genNext }, next);

    expect(getOrchestrationService()).toBe(next);
    await genPrevious.dispose();
    expect(getOrchestrationService()).toBe(next);
    await genNext.dispose();
    expect(getOrchestrationService()).not.toBe(next);
  });
});
