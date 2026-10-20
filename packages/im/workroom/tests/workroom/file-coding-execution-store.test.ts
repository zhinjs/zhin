import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import { FileCodingExecutionStore } from '../../src/workroom/file-coding-execution-store.js';
import { nodeDurableFileSystem } from '../../src/workroom/durable-file-store.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const signal = () => new AbortController().signal;
const ref = { ref: 'test', revision: 1, digest: `sha256:${'1'.repeat(64)}` };
const base = 'a'.repeat(40);
const envelope = createAssignmentExecutionEnvelope({ projectId: 'p', runId: 'r', taskKey: 't', taskRevision: 1, assignmentId: 'a', assignmentRevision: 1, attempt: 1, fence: 1, principalId: 'agent', role: 'executor', agentDefinition: ref, plan: ref, contextPolicy: ref, capabilitySnapshot: ref, policySnapshot: ref, factAnchor: { ref: 'fact', sequence: 1, digest: ref.digest }, workspace: { leaseRef: 'lease', mountRef: 'mount', baseRevision: `git:${base}`, fence: 1 } });
const report = { version: 1, envelopeDigest: envelope.digest, baseCommit: base, commit: 'b'.repeat(40), editsDigest: ref.digest, paths: ['src/a.ts'], image: `example/coding@sha256:${'c'.repeat(64)}` };
async function fixture() { const parent = await mkdtemp(join(tmpdir(), 'zhin-coding-facts-')); dirs.push(parent); const directory = join(parent, 'facts'); return { directory, store: new FileCodingExecutionStore(directory) }; }

describe('durable coding dispatch and report facts', () => {
  it('allows exactly one concurrent dispatch claimant across store instances', async () => {
    const { directory, store } = await fixture();
    const results = await Promise.allSettled([store.claimExecution(envelope, signal()), new FileCodingExecutionStore(directory).claimExecution(envelope, signal())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expect(new FileCodingExecutionStore(directory).claimExecution(envelope, signal())).rejects.toThrow('already dispatched');
  });
  it('restores immutable exact report after restart and replays identical saves', async () => {
    const { directory, store } = await fixture();
    await store.claimExecution(envelope, signal());
    const saved = await store.save(report, signal());
    const reopened = new FileCodingExecutionStore(directory);
    expect(await reopened.find(envelope.digest, signal())).toEqual({ ...saved, report });
    expect(await reopened.save(report, signal())).toEqual(saved);
    expect(saved.digest).toBe(digest(report));
    expect(Object.isFrozen((await reopened.find(envelope.digest, signal()))!.report)).toBe(true);
    await expect(reopened.save({ ...report, commit: 'c'.repeat(40) }, signal())).rejects.toThrow('collision');
  });
  it('keeps a crash with no report query/manual-only after reopening', async () => {
    const { directory, store } = await fixture(); await store.claimExecution(envelope, signal());
    const reopened = new FileCodingExecutionStore(directory);
    expect(await reopened.find(envelope.digest, signal())).toBeUndefined();
    await expect(reopened.claimExecution(envelope, signal())).rejects.toThrow('reconcile manually');
  });
  it('retains claim after publication response loss and never permits redispatch', async () => {
    const { directory } = await fixture();
    const store = new FileCodingExecutionStore(directory, { ...nodeDurableFileSystem, open: async (path, flags) => {
      const handle = await nodeDurableFileSystem.open(path, flags);
      if (path === directory && flags === 'r') return { writeFile: (value, encoding) => handle.writeFile(value, encoding), close: () => handle.close(), sync: async () => { throw new Error('injected directory sync failure'); } };
      return handle;
    } });
    await expect(store.claimExecution(envelope, signal())).rejects.toThrow('injected');
    await expect(new FileCodingExecutionStore(directory).claimExecution(envelope, signal())).rejects.toThrow('already dispatched');
  });
  it('rejects corrupted or incomplete claim instead of silently retrying', async () => {
    const { directory, store } = await fixture(); await store.claimExecution(envelope, signal());
    await writeFile(join(directory, `claim-${envelope.digest.slice(7)}.json`), '{');
    await expect(store.claimExecution(envelope, signal())).rejects.toThrow('incomplete');
    await expect(store.find(envelope.digest, signal())).rejects.toThrow('incomplete');
  });
  it('rejects report corruption and candidate/base authority mismatch', async () => {
    const { directory, store } = await fixture(); await store.claimExecution(envelope, signal());
    await expect(store.save({ ...report, baseCommit: 'c'.repeat(40) }, signal())).rejects.toThrow('authority');
    await store.save(report, signal());
    await writeFile(join(directory, `report-${envelope.digest.slice(7)}.json`), JSON.stringify({ ref: `coding-report:${envelope.digest}`, digest: ref.digest, report }));
    await expect(new FileCodingExecutionStore(directory).find(envelope.digest, signal())).rejects.toThrow('digest');
  });
  it('requires dispatch claim and exact digest paths, and respects cancellation', async () => {
    const { store } = await fixture();
    expect(await store.find(envelope.digest, signal())).toBeUndefined();
    await expect(store.save(report, signal())).rejects.toThrow('dispatch claim');
    await expect(store.find('../other', signal())).rejects.toThrow('exact');
    const controller = new AbortController(); controller.abort();
    await expect(store.claimExecution(envelope, controller.signal)).rejects.toThrow();
    await store.claimExecution(envelope, signal());
  });
});
