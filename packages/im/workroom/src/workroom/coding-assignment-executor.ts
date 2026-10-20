import { spawn } from 'node:child_process';
import { digestCanonicalWorkroomValue as digest } from './canonical-value.js';
import {
  assertAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionObservation,
  type AssignmentExecutorPort,
} from './assignment-executor.js';

export interface CodingFile {
  readonly path: string;
  readonly content: string;
  readonly mode: '100644' | '100755';
}
export interface CodingEdit {
  readonly path: string;
  /** null deletes an existing file. Only regular UTF-8 files are supported. */
  readonly content: string | null;
}
export interface CodingAssignmentSnapshot {
  readonly envelopeDigest: string;
  readonly baseCommit: string;
  readonly baseTree: string;
  readonly files: readonly CodingFile[];
  readonly writablePaths: readonly string[];
  readonly instruction: string;
  /** Pinned, locally provisioned image implementing stdin request / stdout edits JSON. */
  readonly image: string;
  readonly command: readonly string[];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly memoryMiB: number;
  readonly workspaceMiB: number;
  readonly cpus: number;
}
export interface CodingAssignmentSnapshotPort {
  /** Resolve the operation's pinned generation, not a latest-value configuration. */
  resolve(envelope: AssignmentExecutionEnvelope, signal: AbortSignal): Promise<CodingAssignmentSnapshot>;
  /** Must verify current lease, attempt, fence and cancellation against authoritative state. */
  assertCurrent(envelope: AssignmentExecutionEnvelope, signal: AbortSignal): Promise<void>;
  /** Atomically persist dispatch ownership in the existing assignment store; duplicates fail closed.
   * A crash without a report requires explicit reconciliation, never automatic redispatch. */
  claimExecution(envelope: AssignmentExecutionEnvelope, signal: AbortSignal): Promise<void>;
  /** Release only this successful dispatch claim's resources; never clear its durable dispatch fact. */
  release(envelope: AssignmentExecutionEnvelope): Promise<void>;
}
export interface CodingObjectsPort {
  /** Trusted gateway owns credentials; these methods never update a ref or create a PR. */
  createBlob(content: string, signal: AbortSignal): Promise<string>;
  createTree(baseTree: string, entries: readonly { path: string; mode: '100644' | '100755'; type: 'blob'; sha: string | null }[], signal: AbortSignal): Promise<string>;
  createCommit(tree: string, parent: string, message: string, signal: AbortSignal): Promise<string>;
}
export interface CodingReportPort {
  /** Lookup is keyed by envelope digest and returns only durable, trusted records. */
  find(envelopeDigest: string, signal: AbortSignal): Promise<{ ref: string; digest: string; report: Readonly<Record<string, unknown>> } | undefined>;
  /** Durable immutable storage, addressed by content digest and indexed by envelope digest. */
  save(report: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<{ ref: string; digest: string }>;
}

/** Fixed Docker transport: no bind mounts, inherited environment or networking in the guest. */
export class DockerCodingAssignmentExecutor implements AssignmentExecutorPort {
  constructor(
    private readonly snapshots: CodingAssignmentSnapshotPort,
    private readonly objects: CodingObjectsPort,
    private readonly reports: CodingReportPort,
    private readonly dockerBinary = 'docker',
  ) {}

  async *execute(envelope: AssignmentExecutionEnvelope, signal: AbortSignal): AsyncIterable<AssignmentExecutionObservation> {
    assertAssignmentExecutionEnvelope(envelope);
    signal.throwIfAborted();
    const snapshot = structuredClone(await this.snapshots.resolve(envelope, signal));
    const name = `zhin-coding-${envelope.digest.slice(7)}`;
    let ownsDispatch = false;
    try {
      validateSnapshot(snapshot, envelope);
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(snapshot.timeoutMs)]);
      await this.snapshots.assertCurrent(envelope, boundedSignal);
      const prior = await this.reports.find(envelope.digest, boundedSignal);
      if (prior) {
        if (prior.digest !== digest(prior.report) || prior.report.envelopeDigest !== envelope.digest || prior.report.baseCommit !== snapshot.baseCommit || typeof prior.report.commit !== 'string') throw new Error('Coding recovered report authority mismatch');
        assertSha(prior.report.commit);
        await this.snapshots.assertCurrent(envelope, boundedSignal);
        boundedSignal.throwIfAborted();
        yield { version: 1, type: 'execution_completed', observationId: `${name}/completed`, envelopeDigest: envelope.digest, completion: { report: { ref: prior.ref, digest: prior.digest }, candidate: { ref: `git:${prior.report.commit}`, hash: digest({ baseCommit: snapshot.baseCommit, commit: prior.report.commit }) } } };
        return;
      }
      await this.snapshots.claimExecution(envelope, boundedSignal);
      ownsDispatch = true;
      yield { version: 1, type: 'progress', observationId: `${name}/started`, envelopeDigest: envelope.digest, progress: { summary: 'Running pinned coding image in isolated Docker workspace' } };
      const input = JSON.stringify({ version: 1, envelopeDigest: envelope.digest, baseCommit: snapshot.baseCommit, instruction: snapshot.instruction, files: snapshot.files });
      if (Buffer.byteLength(input) > snapshot.maxBytes) throw new Error('Coding input exceeds byte budget');
      const output = await runCodingProcess(this.dockerBinary, codingDockerArgs(snapshot, name), input, boundedSignal, snapshot.maxBytes);
      // Stop the entire guest before interpreting candidate-controlled output.
      await this.removeContainer(name);
      boundedSignal.throwIfAborted();
      const edits = validateCodingEdits(JSON.parse(output), snapshot);
      await this.snapshots.assertCurrent(envelope, boundedSignal);
      const commit = await uploadCodingObjects(snapshot, edits, this.objects, boundedSignal);
      await this.snapshots.assertCurrent(envelope, boundedSignal);
      const report = { version: 1, envelopeDigest: envelope.digest, baseCommit: snapshot.baseCommit, commit, editsDigest: digest(edits), paths: edits.map(edit => edit.path), image: snapshot.image };
      const stored = await this.reports.save(report, boundedSignal);
      if (stored.digest !== digest(report)) throw new Error('Coding report storage digest mismatch');
      await this.snapshots.assertCurrent(envelope, boundedSignal);
      boundedSignal.throwIfAborted();
      yield { version: 1, type: 'execution_completed', observationId: `${name}/completed`, envelopeDigest: envelope.digest, completion: { report: stored, candidate: { ref: `git:${commit}`, hash: digest({ baseCommit: snapshot.baseCommit, commit }) } } };
    } finally {
      try { if (ownsDispatch) await this.removeContainer(name); } finally { if (ownsDispatch) await this.snapshots.release(envelope); }
    }
  }

  private async removeContainer(name: string): Promise<void> {
    // rm -f addresses the daemon-side container even when the attached CLI was killed.
    try { await runCodingProcess(this.dockerBinary, ['rm', '-f', name], '', AbortSignal.timeout(10_000), 16_384); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('No such container')) throw error;
    }
  }
}

export function codingDockerArgs(snapshot: CodingAssignmentSnapshot, name: string): string[] {
  return ['run', '--rm', '--pull=never', '--name', name, '--label=dev.zhin.coding-executor=1', `--label=dev.zhin.envelope=${snapshot.envelopeDigest}`, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', `--memory=${snapshot.memoryMiB}m`, `--memory-swap=${snapshot.memoryMiB}m`, `--cpus=${snapshot.cpus}`, '--user=65534:65534', '--workdir=/workspace', `--tmpfs=/workspace:rw,nosuid,nodev,size=${snapshot.workspaceMiB}m,mode=1777`, '--tmpfs=/tmp:rw,nosuid,nodev,size=32m,mode=1777', '--entrypoint', snapshot.command[0]!, '-i', snapshot.image, ...snapshot.command.slice(1)];
}

export function validateCodingEdits(value: unknown, snapshot: CodingAssignmentSnapshot): CodingEdit[] {
  if (!value || typeof value !== 'object' || Object.keys(value).join() !== 'edits' || !Array.isArray((value as { edits?: unknown }).edits)) throw new Error('Coding output requires only edits');
  const edits = (value as { edits: unknown[] }).edits;
  if (!edits.length || edits.length > 256 || Buffer.byteLength(JSON.stringify(value)) > snapshot.maxBytes) throw new Error('Coding output exceeds change budget or has no edits');
  const seen = new Set<string>();
  return edits.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid coding edit');
    const edit = value as CodingEdit;
    if (Object.keys(edit).sort().join() !== 'content,path' || typeof edit.path !== 'string' || (edit.content !== null && typeof edit.content !== 'string')) throw new Error('Invalid coding edit');
    assertPath(edit.path);
    if (!snapshot.writablePaths.some(path => edit.path === path || (path.endsWith('/') && edit.path.startsWith(path)))) throw new Error(`Coding path outside authorized scope: ${edit.path}`);
    if (seen.has(edit.path)) throw new Error('Duplicate coding path');
    seen.add(edit.path);
    if (edit.content === null && !snapshot.files.some(file => file.path === edit.path)) throw new Error('Cannot delete unknown coding file');
    return { path: edit.path, content: edit.content };
  });
}

/** Upload unreachable objects only. Ref/PR mutation must still pass the existing Git Gateway. */
export async function uploadCodingObjects(snapshot: CodingAssignmentSnapshot, edits: readonly CodingEdit[], objects: CodingObjectsPort, signal: AbortSignal): Promise<string> {
  assertSha(snapshot.baseCommit); assertSha(snapshot.baseTree);
  const checked = validateCodingEdits({ edits }, snapshot);
  const entries = [];
  for (const edit of checked) {
    signal.throwIfAborted();
    const sha = edit.content === null ? null : await objects.createBlob(edit.content, signal);
    if (sha !== null) assertSha(sha);
    entries.push({ path: edit.path, mode: snapshot.files.find(file => file.path === edit.path)?.mode ?? '100644' as const, type: 'blob' as const, sha });
  }
  signal.throwIfAborted();
  const tree = await objects.createTree(snapshot.baseTree, entries, signal);
  assertSha(tree);
  signal.throwIfAborted();
  const commit = await objects.createCommit(tree, snapshot.baseCommit, `Workroom candidate ${snapshot.envelopeDigest}`, signal);
  assertSha(commit);
  return commit;
}

function validateSnapshot(snapshot: CodingAssignmentSnapshot, envelope: AssignmentExecutionEnvelope): void {
  if (snapshot.envelopeDigest !== envelope.digest || snapshot.baseCommit !== envelope.workspace.baseRevision.replace(/^git:/u, '')) throw new Error('Coding snapshot authority mismatch');
  assertSha(snapshot.baseCommit); assertSha(snapshot.baseTree);
  if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/u.test(snapshot.image)) throw new Error('Coding image requires immutable digest');
  if (!snapshot.command.length || snapshot.command.some(arg => !arg || arg.includes('\0'))) throw new Error('Coding command is invalid');
  for (const n of [snapshot.timeoutMs, snapshot.maxBytes, snapshot.memoryMiB, snapshot.workspaceMiB]) if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Coding budget must be positive');
  // Node timers above signed 32-bit delay overflow to 1ms, even where the
  // AbortSignal API accepts an unsigned 32-bit value. Reject before dispatch.
  if (snapshot.timeoutMs > 2_147_483_647) throw new Error('Coding timeout exceeds platform timer upper bound');
  if (!Number.isFinite(snapshot.cpus) || snapshot.cpus <= 0) throw new Error('Coding CPU budget must be positive');
  for (const path of snapshot.writablePaths) assertPath(path.endsWith('/') ? path.slice(0, -1) : path);
  const seen = new Set<string>();
  for (const file of snapshot.files) {
    assertPath(file.path);
    if (seen.has(file.path) || !['100644', '100755'].includes(file.mode) || typeof file.content !== 'string') throw new Error('Invalid coding base file');
    seen.add(file.path);
  }
}
function assertSha(value: string): void { if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error('Coding Git object requires exact SHA-1'); }
function assertPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || Array.from(path).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') || (path.toLowerCase() === '.github' || path.toLowerCase().startsWith('.github/'))) throw new Error(`Unsafe coding path: ${path}`);
}

/** No shell; bounded stdout/stderr; cancellation kills the attached process and waits for exit.
 * Strict UTF-8 mode validates raw stdout bytes before any lossy decoding. */
export async function runCodingProcess(binary: string, args: readonly string[], input: string, signal: AbortSignal, maxBytes: number, cwd?: string, strictUtf8 = false): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], { cwd, env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }, stdio: 'pipe' });
    const output: Buffer[] = []; const errors: Buffer[] = [];
    let bytes = 0; let failure: Error | undefined;
    const stop = (): void => { failure ??= new Error('Coding process aborted'); child.kill('SIGKILL'); };
    const collect = (target: Buffer[]) => (chunk: Buffer): void => { bytes += chunk.length; if (bytes > maxBytes) { failure = new Error('Coding process exceeds output budget'); child.kill('SIGKILL'); } else target.push(chunk); };
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
    child.stdin.on('error', () => { /* Exit/error handler owns the result. */ });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.once('error', error => { signal.removeEventListener('abort', stop); reject(error); });
    child.once('close', code => {
      signal.removeEventListener('abort', stop);
      if (failure) { reject(failure); return; }
      if (code !== 0) {
        reject(new Error(`Coding process exited ${code}: ${Buffer.concat(errors).toString('utf8').slice(0, 1024)}`));
        return;
      }
      try {
        const bytes = Buffer.concat(output);
        resolve(strictUtf8 ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) : bytes.toString('utf8'));
      } catch { reject(new Error('Coding process output requires valid UTF-8')); }
    });
    child.stdin.end(input);
  });
}

/** Read-only infrastructure check; image availability does not prove a model/backend integration. */
export async function inspectCodingDockerReadiness(image: string, signal: AbortSignal, dockerBinary = 'docker'): Promise<{ ready: boolean; blockers: string[] }> {
  signal.throwIfAborted();
  if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/u.test(image)) return { ready: false, blockers: ['coding_image_digest_required'] };
  try {
    await runCodingProcess(dockerBinary, ['info', '--format', '{{.ServerVersion}}'], '', signal, 16_384);
    signal.throwIfAborted();
  } catch { signal.throwIfAborted(); return { ready: false, blockers: ['docker_daemon_unavailable'] }; }
  try {
    const output = await runCodingProcess(dockerBinary, ['image', 'inspect', '--format', '{{json .RepoDigests}}', image], '', signal, 16_384);
    signal.throwIfAborted();
    const digests: unknown = JSON.parse(output);
    if (!Array.isArray(digests) || !digests.includes(image)) return { ready: false, blockers: ['coding_image_digest_mismatch'] };
    return { ready: true, blockers: [] };
  } catch { signal.throwIfAborted(); return { ready: false, blockers: ['coding_image_not_provisioned'] }; }
}

/** Reconcile daemon leftovers using current assignment authority, without redispatching work. */
export async function reconcileCodingContainers(
  isStale: (envelopeDigest: string, signal: AbortSignal) => Promise<boolean>,
  signal: AbortSignal,
  dockerBinary = 'docker',
): Promise<{ inspected: number; removed: string[] }> {
  const output = await runCodingProcess(dockerBinary, ['ps', '-a', '--filter', 'label=dev.zhin.coding-executor=1', '--format', '{{.Names}}'], '', signal, 65_536);
  const names = output.split('\n').filter(Boolean);
  const removed: string[] = [];
  for (const name of names) {
    if (!/^zhin-coding-[a-f0-9]{64}$/u.test(name)) throw new Error('Unexpected coding container identity');
    const envelopeDigest = `sha256:${name.slice('zhin-coding-'.length)}`;
    if (!await isStale(envelopeDigest, signal)) continue;
    signal.throwIfAborted();
    await runCodingProcess(dockerBinary, ['rm', '-f', name], '', signal, 16_384);
    removed.push(name);
  }
  return { inspected: names.length, removed };
}
