import { AttemptReplayEvidence } from '../../src/schedule-domain/replay-evidence.js';

describe('attempt-owned operation evidence', () => {
  const operation = { turnId: 'turn', toolUseId: 'call', toolName: 'native_write', readOnly: false };

  it('never forgets a confirmed effect when the same invocation reports later outcomes', () => {
    const evidence = new AttemptReplayEvidence();
    const invocation = evidence.started(operation);
    invocation.report({ disposition: 'committed' });
    invocation.report({ disposition: 'unknown' });
    invocation.report({ disposition: 'not_submitted' });
    expect(evidence.snapshot()).toMatchObject({ disposition: 'committed', operations: [{ status: 'committed' }] });
  });

  it('allows an action owner to resolve initial uncertainty with proof of non-submission', () => {
    const evidence = new AttemptReplayEvidence();
    const invocation = evidence.started(operation);
    expect(evidence.snapshot().disposition).toBe('unknown');
    invocation.report({ disposition: 'not_submitted' });
    expect(evidence.snapshot()).toMatchObject({ disposition: 'safe', reason: 'not_submitted' });
  });

  it('keeps independent calls and captured snapshots separate', () => {
    const evidence = new AttemptReplayEvidence();
    const first = evidence.started(operation);
    first.report({ disposition: 'committed' });
    const captured = evidence.snapshot();
    const second = evidence.started({ ...operation, toolUseId: 'second' });
    expect(evidence.snapshot().disposition).toBe('unknown');
    second.report({ disposition: 'not_submitted' });
    expect(evidence.snapshot().disposition).toBe('committed');
    expect(captured.operations).toHaveLength(1);
    expect(captured.operations[0]?.status).toBe('committed');
  });
});
