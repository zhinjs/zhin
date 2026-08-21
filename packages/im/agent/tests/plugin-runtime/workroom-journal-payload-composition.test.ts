import { describe, expect, it } from 'vitest';
import {
  createGenerationOwnedWorkroomJournalPayloadPort,
} from '../../src/plugin-runtime/workroom-journal-payload-composition.js';
import {
  MemoryWorkroomJournalPayloadPort,
  WorkroomJournalPayloadAuthorityUnavailableError,
} from '../../src/workroom/journal.js';

describe('generation-owned Workroom Journal payload composition', () => {
  it('fails closed until exact activation and cannot replace the generation authority', async () => {
    const generation = new AbortController();
    const latch = createGenerationOwnedWorkroomJournalPayloadPort({
      generation: 7,
      signal: generation.signal,
    });
    const input = journalWriteInput();
    await expect(latch.payloads.write(input))
      .rejects.toBeInstanceOf(WorkroomJournalPayloadAuthorityUnavailableError);

    const authority = new MemoryWorkroomJournalPayloadPort();
    latch.activate(authority);
    const receipt = await latch.payloads.write(input);
    await expect(latch.payloads.read({
      projectId: input.projectId,
      runId: input.runId,
      eventId: input.eventId,
      eventType: input.eventType,
      fieldPath: input.fieldPath,
      contentHash: input.contentHash,
      receipt,
      purpose: 'kernel-replay',
    })).resolves.toBe('private title');
    expect(() => latch.activate(new MemoryWorkroomJournalPayloadPort()))
      .toThrow('already active');
  });

  it('rejects operations after its owning generation retires', async () => {
    const generation = new AbortController();
    const latch = createGenerationOwnedWorkroomJournalPayloadPort({
      generation: 8,
      signal: generation.signal,
    });
    latch.activate(new MemoryWorkroomJournalPayloadPort());
    const reason = new DOMException('generation retired', 'AbortError');
    generation.abort(reason);
    await expect(latch.payloads.write(journalWriteInput())).rejects.toBe(reason);
  });
});

function journalWriteInput() {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    eventId: 'event-1',
    eventType: 'run.created' as const,
    fieldPath: '$.payload.title',
    value: 'private title',
    contentHash: 'sha256:5e1f932375a4f0073e84fd42edddc76c5d1cfacf4f35c2e12d488c9f3497f929',
    source: {
      ref: 'workroom-journal-event:run-1:event-1:$.payload.title',
      digest: `sha256:${'a'.repeat(64)}`,
      bindingDigest: `sha256:${'b'.repeat(64)}`,
    },
  };
}
