import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { DurableFileStore, nodeDurableFileSystem } from '../../src/workroom/durable-file-store.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWorkroomEffectJournal } from '../../src/workroom/file-effect-ledger.js';
import {
  WorkroomEffectSequenceConflictError,
  createWorkroomEffectIntent,
} from '../../src/workroom/effect-ledger.js';

describe('File Workroom Effect Journal', () => {
  it('reads committed facts while a real durable publication is paused before linking', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-journal-publication-'));
    try {
      const journal = new FileWorkroomEffectJournal(directory);
      await journal.append('project-1', -1, [{ type: 'effect.intent_recorded', payload: { intent: testIntent() } }]);
      const [name] = await readdir(directory);
      const target = join(directory, name!);
      let entered!: () => void;
      let resume!: () => void;
      const paused = new Promise<void>(resolve => { entered = resolve; });
      const released = new Promise<void>(resolve => { resume = resolve; });
      const publisher = new DurableFileStore(directory, { ...nodeDurableFileSystem, link: async (from, to) => {
        entered(); await released; await nodeDurableFileSystem.link(from, to);
      } });
      const pending = publisher.publishCreateOnly({ target, content: await readFile(target, 'utf8'), createdValue: null, onConflict: async () => null });
      await paused;
      try { expect(await journal.read('project-1')).toHaveLength(1); }
      finally { resume(); await pending; }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('ignores only canonical orphan temporary files and still rejects corrupt segments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-journal-orphan-'));
    try {
      const journal = new FileWorkroomEffectJournal(directory);
      await journal.append('project-1', -1, [{ type: 'effect.intent_recorded', payload: { intent: testIntent() } }]);
      const [name] = await readdir(directory);
      await writeFile(join(directory, `${name}.${randomUUID()}.tmp`), '{');
      expect(await new FileWorkroomEffectJournal(directory).read('project-1')).toHaveLength(1);
      const unexpected = join(directory, `${name}.unexpected.tmp`);
      await writeFile(unexpected, '{');
      await expect(journal.read('project-1')).rejects.toThrow('segment name');
      await rm(unexpected);
      await writeFile(join(directory, name!), '{');
      await expect(journal.read('project-1')).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

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

function testIntent() {
  return createWorkroomEffectIntent({
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
}
