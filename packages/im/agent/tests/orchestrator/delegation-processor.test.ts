import { describe, it, expect, vi } from 'vitest';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import { DelegationProcessor } from '../../src/orchestrator/delegation-processor.js';

describe('DelegationProcessor', () => {
  it('completes mesh delegation tasks through OrchestrationKernel', async () => {
    const repo = new MemoryOrchestrationRepository();
    const orch = initOrchestrationService(repo);
    const prompt = vi.fn().mockResolvedValue([{ type: 'text', content: 'Mesh result body' }]);
    const processor = new DelegationProcessor({
      zhinAgent: { prompt } as never,
      pollIntervalMs: 60_000,
    });

    const { remote_task_id, run_id } = await processor.createDelegation({
      title: 'Mesh job',
      description: 'Do the thing',
    });

    await vi.waitFor(async () => {
      const task = await repo.getTask(remote_task_id);
      expect(task?.status).toBe('completed');
      expect(task?.result_summary).toBe('Mesh result body');
    }, { timeout: 5000 });

    const snapshot = await orch.getSnapshot(run_id);
    expect(snapshot.events.map((e) => e.type)).toContain('task.completed');
    expect(snapshot.events.map((e) => e.type)).toContain('result.returned');
    expect(prompt).toHaveBeenCalledOnce();

    processor.stop();
  });
});
