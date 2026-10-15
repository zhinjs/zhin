import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertAssignmentExecutionEnvelope, type AssignmentExecutionEnvelope } from './assignment-executor.js';
import { deepFreezeWorkroomValue as freeze, digestCanonicalWorkroomValue as digest } from './canonical-value.js';
import type { CodingReportPort } from './coding-assignment-executor.js';
import { DurableFileStore, type DurableFileSystem } from './durable-file-store.js';

type StoredReport = { ref: string; digest: string; report: Readonly<Record<string, unknown>> };
interface Claim { version: 1; kind: 'coding_dispatch'; envelope: AssignmentExecutionEnvelope }

/**
 * Immutable dispatch/production facts only. This store grants no lease or permission:
 * SnapshotPort.assertCurrent must still consult the existing Assignment authority.
 * A claim without a report is query/manual-reconciliation only and is never redispatched.
 */
export class FileCodingExecutionStore implements CodingReportPort {
  readonly #store: DurableFileStore;
  constructor(directory: string, fileSystem?: DurableFileSystem) {
    this.#store = new DurableFileStore(directory, fileSystem);
  }

  async claimExecution(envelope: AssignmentExecutionEnvelope, signal: AbortSignal): Promise<void> {
    assertAssignmentExecutionEnvelope(envelope);
    signal.throwIfAborted();
    await this.#store.ensureDurableLeaf('Coding execution facts');
    const record: Claim = { version: 1, kind: 'coding_dispatch', envelope };
    const content = JSON.stringify(record);
    signal.throwIfAborted();
    await this.#store.publishCreateOnly({
      target: this.#path('claim', envelope.digest), content, createdValue: undefined,
      onConflict: async () => {
        const existing = await this.#claim(envelope.digest);
        if (!existing || digest(existing) !== digest(record)) throw new Error('Coding dispatch claim collision or incomplete record');
        throw new Error('Coding execution already dispatched; recover report or reconcile manually');
      },
    });
    // A cancellation after durable publication retains the fact and prevents unsafe retries.
    signal.throwIfAborted();
  }

  async find(envelopeDigest: string, signal: AbortSignal): Promise<StoredReport | undefined> {
    signal.throwIfAborted();
    const claim = await this.#claim(envelopeDigest);
    const value = await this.#read(this.#path('report', envelopeDigest));
    if (value === undefined) return undefined;
    if (!claim) throw new Error('Coding report has no dispatch claim');
    const stored = this.#validateStored(value, envelopeDigest, claim);
    // Complete a previous publication whose response/directory sync may have been lost.
    await this.#store.syncLeaf();
    signal.throwIfAborted();
    return stored;
  }

  async save(input: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<{ ref: string; digest: string }> {
    signal.throwIfAborted();
    const report = JSON.parse(JSON.stringify(input)) as Readonly<Record<string, unknown>>;
    const envelopeDigest = report.envelopeDigest;
    if (typeof envelopeDigest !== 'string') throw new Error('Coding report requires envelope digest');
    const claim = await this.#claim(envelopeDigest);
    if (!claim) throw new Error('Coding report requires a durable dispatch claim');
    const stored = this.#validateStored({ ref: `coding-report:${envelopeDigest}`, digest: digest(report), report }, envelopeDigest, claim);
    const content = JSON.stringify(stored);
    if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('Coding report exceeds storage budget');
    signal.throwIfAborted();
    await this.#store.publishCreateOnly({
      target: this.#path('report', envelopeDigest), content, createdValue: stored,
      onConflict: async () => {
        const existing = await this.find(envelopeDigest, signal);
        if (!existing || existing.digest !== stored.digest) throw new Error('Coding immutable report collision');
        return existing;
      },
    });
    signal.throwIfAborted();
    return { ref: stored.ref, digest: stored.digest };
  }

  #path(kind: 'claim' | 'report', envelopeDigest: string): string {
    if (!/^sha256:[a-f0-9]{64}$/u.test(envelopeDigest)) throw new Error('Coding storage requires exact envelope digest');
    return join(this.#store.directory, `${kind}-${envelopeDigest.slice(7)}.json`);
  }
  async #read(file: string): Promise<unknown | undefined> {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Invalid coding immutable fact file');
      return JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('Coding immutable fact is corrupt or incomplete', { cause: error });
    }
  }
  async #claim(envelopeDigest: string): Promise<Claim | undefined> {
    const value = await this.#read(this.#path('claim', envelopeDigest));
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object') throw new Error('Invalid coding dispatch claim');
    const claim = value as Claim;
    if (Object.keys(claim).sort().join() !== 'envelope,kind,version' || claim.version !== 1 || claim.kind !== 'coding_dispatch') throw new Error('Invalid coding dispatch claim');
    assertAssignmentExecutionEnvelope(freeze(claim.envelope));
    if (claim.envelope.digest !== envelopeDigest) throw new Error('Coding claim envelope digest mismatch');
    return claim;
  }
  #validateStored(value: unknown, envelopeDigest: string, claim: Claim): StoredReport {
    if (!value || typeof value !== 'object') throw new Error('Invalid coding stored report');
    const stored = value as StoredReport;
    if (Object.keys(stored).sort().join() !== 'digest,ref,report' || !stored.report || typeof stored.report !== 'object'
      || stored.ref !== `coding-report:${envelopeDigest}` || stored.digest !== digest(stored.report)) throw new Error('Coding stored report digest mismatch');
    const report = stored.report;
    if (report.version !== 1 || report.envelopeDigest !== envelopeDigest
      || report.baseCommit !== claim.envelope.workspace.baseRevision.replace(/^git:/u, '')
      || typeof report.commit !== 'string' || !/^[a-f0-9]{40}$/u.test(report.commit)) throw new Error('Coding report candidate authority mismatch');
    return freeze(stored);
  }
}
