import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWorkroomEffectJournal } from '../../src/workroom/file-effect-ledger.js';
import {
  WorkroomEffectSequenceConflictError,
  createWorkroomEffectIntent,
} from '../../src/workroom/effect-ledger.js';

describe('File Workroom Effect Journal', () => {
  it('persists content-free immutable CAS events across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-effect-ledger-'));
    const first = new FileWorkroomEffectJournal(directory);
    const intent = createWorkroomEffectIntent({
      projectId: 'project-1', runId: 'run-1', taskKey: 'integrate', taskRevision: 1,
      candidateHash: sha('a'), capability: { ref: 'capability:git', digest: sha('b') },
      operation: { kind: 'git_push', parameters: {
        repositoryId: 'github:owner/repo', ref: 'refs/heads/attempt-1', headSha: 'a'.repeat(40),
        changedPaths: ['src/index.ts'],
      } },
      target: { ref: 'github:owner/repo:attempt-1', digest: sha('c') }, preconditions: [],
      risk: { assessmentRef: 'risk:1', assessmentDigest: sha('d'), tier: 'high' },
      reversibility: { kind: 'compensatable', compensation: { operation: 'delete_branch', requiresReceipt: true } },
      idempotencyKey: 'effect:1', createdAt: 1,
    });
    await first.append('project-1', -1, [{
      type: 'effect.intent_recorded',
      payload: { intent },
    }]);

    const restarted = new FileWorkroomEffectJournal(directory);
    expect(await restarted.read('project-1')).toHaveLength(1);
    await expect(restarted.append('project-1', -1, [{
      type: 'effect.cancelled', payload: { effectId: intent.id, operationId: 'cancel', cancelledAt: 1 },
    }])).rejects.toBeInstanceOf(WorkroomEffectSequenceConflictError);

    const bodies = await Promise.all((await readdir(directory)).map(name => readFile(join(directory, name), 'utf8')));
    expect(bodies.join('')).not.toMatch(/credential|token|password|secret/iu);
  });
});

function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
