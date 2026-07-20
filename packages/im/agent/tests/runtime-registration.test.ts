import { afterEach, describe, expect, it } from 'vitest';
import {
  getScheduleManager,
  registerScheduleManager,
  setScheduleManager,
} from '../src/schedule-manager.js';
import {
  getAssistantRuntime,
  registerAssistantRuntime,
  setAssistantRuntime,
} from '../src/assistant/runtime-registry.js';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  getOrchestrationService,
  OrchestrationService,
  registerOrchestrationService,
} from '../src/orchestrator/orchestration-service.js';

afterEach(() => {
  setScheduleManager(null);
  setAssistantRuntime(null);
});

describe('generation-owned Agent runtime registrations', () => {
  it('keeps the latest schedule manager when the previous owner disposes', () => {
    const previous = { scheduleFeature: { getStatus: () => [] }, engine: null };
    const next = { scheduleFeature: { getStatus: () => [] }, engine: null };
    const disposePrevious = registerScheduleManager(previous);
    const disposeNext = registerScheduleManager(next);

    disposePrevious();
    expect(getScheduleManager()).toBe(next);
    disposeNext();
    expect(getScheduleManager()).toBeNull();
  });

  it('lets a disabled generation override and then reveal the previous Assistant', () => {
    const previous = { id: 'previous' } as never;
    const disposePrevious = registerAssistantRuntime(previous);
    const disposeNext = registerAssistantRuntime(null);

    expect(getAssistantRuntime()).toBeNull();
    disposeNext();
    expect(getAssistantRuntime()).toBe(previous);
    disposePrevious();
    expect(getAssistantRuntime()).toBeNull();
  });

  it('keeps orchestration bound to the newest live generation', () => {
    const previous = new OrchestrationService(new MemoryOrchestrationRepository());
    const next = new OrchestrationService(new MemoryOrchestrationRepository());
    const disposePrevious = registerOrchestrationService(previous);
    const disposeNext = registerOrchestrationService(next);

    expect(getOrchestrationService()).toBe(next);
    disposePrevious();
    expect(getOrchestrationService()).toBe(next);
    disposeNext();
    expect(getOrchestrationService()).not.toBe(next);
  });
});
