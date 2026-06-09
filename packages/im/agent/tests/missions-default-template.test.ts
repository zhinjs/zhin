/**
 * orchestration_start 省略 template 时默认 missions。
 */
import { describe, it, expect } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  initOrchestrationService,
  MISSIONS_TEMPLATE,
} from '../src/orchestrator/orchestration-service.js';

describe('missions default template', () => {
  it('startRun without template creates missions DAG', async () => {
    const repo = new MemoryOrchestrationRepository();
    const svc = initOrchestrationService(repo);

    const snapshot = await svc.startRun({
      sessionKey: 'sandbox:bot:private:user1',
      title: 'auto mission',
    });

    expect(snapshot.run.template).toBe(MISSIONS_TEMPLATE);
    expect(snapshot.tasks).toHaveLength(5);
  });

  it('remote Validate via startRun remoteValidator', async () => {
    const repo = new MemoryOrchestrationRepository();
    const svc = initOrchestrationService(repo);
    const snapshot = await svc.startRun({
      sessionKey: 'k',
      remoteValidator: 'lab-validator',
    });
    const validate = snapshot.tasks.find((t) => t.phase === 'validate');
    expect(validate?.executor_kind).toBe('remote');
    expect(validate?.remote_agent_id).toBe('lab-validator');
  });
});
