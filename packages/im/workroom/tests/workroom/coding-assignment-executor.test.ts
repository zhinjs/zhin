import { mkdtemp, rm, writeFile, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockerCodingAssignmentExecutor, inspectCodingDockerReadiness, reconcileCodingContainers, codingDockerArgs, runCodingProcess, uploadCodingObjects, validateCodingEdits, type CodingAssignmentSnapshot, type CodingObjectsPort } from '../../src/workroom/coding-assignment-executor.js';
import { createCodingGitHubObjectsPort, readCodingGitSnapshot } from '../../src/workroom/coding-git-objects.js';

import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const sha = 'a'.repeat(40);
function snapshot(): CodingAssignmentSnapshot {
  return { envelopeDigest: `sha256:${'1'.repeat(64)}`, baseCommit: sha, baseTree: sha, files: [{ path: 'src/a.ts', content: 'before', mode: '100755' }], writablePaths: ['src/'], instruction: 'fix', image: `example/coding@sha256:${'a'.repeat(64)}`, command: ['/usr/bin/coding'], timeoutMs: 10_000, maxBytes: 4096, memoryMiB: 128, workspaceMiB: 64, cpus: 1 };
}
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('isolated coding boundary', () => {
  it.each(['../secret', '/tmp/file', 'src/../secret', 'src/.git/config', '.github', '.github/workflows/publish.yml', 'src\\secret', 'src//a', 'other/a.ts'])('rejects unauthorized path %s before upload', path => {
    expect(() => validateCodingEdits({ edits: [{ path, content: 'x' }] }, snapshot())).toThrow();
  });
  it('rejects duplicates, unknown deletions, arbitrary output and oversize edits', () => {
    expect(() => validateCodingEdits({ edits: [{ path: 'src/a', content: 'a' }, { path: 'src/a', content: 'b' }] }, snapshot())).toThrow('Duplicate');
    expect(() => validateCodingEdits({ edits: [{ path: 'src/no', content: null }] }, snapshot())).toThrow('unknown');
    expect(() => validateCodingEdits({ edits: [], command: 'oops' }, snapshot())).toThrow();
    expect(() => validateCodingEdits({ edits: [{ path: 'src/a', content: 'a'.repeat(5000) }] }, snapshot())).toThrow('budget');
  });
  it('uploads only validated objects, retains mode and never changes refs', async () => {
    const port: CodingObjectsPort = { createBlob: vi.fn(async () => sha), createTree: vi.fn(async () => sha), createCommit: vi.fn(async () => sha) };
    await expect(uploadCodingObjects(snapshot(), [{ path: 'bad', content: 'x' }], port, new AbortController().signal)).rejects.toThrow('scope');
    expect(port.createBlob).not.toHaveBeenCalled();
    await expect(uploadCodingObjects(snapshot(), [{ path: 'src/a.ts', content: 'after' }], port, new AbortController().signal)).resolves.toBe(sha);
    expect(port.createTree).toHaveBeenCalledWith(sha, [{ path: 'src/a.ts', mode: '100755', type: 'blob', sha }], expect.any(AbortSignal));
    expect(port.createCommit).toHaveBeenCalledWith(sha, sha, expect.any(String), expect.any(AbortSignal));
  });
  it('fixes network, root, resource, user and filesystem isolation without host mounts', () => {
    const args = codingDockerArgs(snapshot(), 'test');
    expect(args).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--pull=never', '--memory=128m']));
    expect(args.some(arg => arg === '-v' || arg.startsWith('--mount') || arg === '-e')).toBe(false);
  });
  it('actually runs a bounded child without inherited secret environment', async () => {
    process.env.CODING_TEST_SECRET = 'must-not-reach-child';
    try { expect(await runCodingProcess(process.execPath, ['-e', 'process.stdout.write(String(process.env.CODING_TEST_SECRET))'], '', new AbortController().signal, 1024)).toBe('undefined'); }
    finally { delete process.env.CODING_TEST_SECRET; }
  });
  it('kills a real hanging child on timeout and caps output', async () => {
    await expect(runCodingProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', AbortSignal.timeout(50), 1024)).rejects.toThrow('aborted');
    await expect(runCodingProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(10000))'], '', new AbortController().signal, 100)).rejects.toThrow('budget');
  });
  it('reads exact committed files from a real temporary Git repo, excluding dirty edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-coding-test-')); paths.push(dir);
    const signal = new AbortController().signal;
    const git = (args: string[]) => runCodingProcess('git', args, '', signal, 4096, dir);
    await git(['init']); await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src/a.ts'), 'committed\n');
    await git(['add', 'src/a.ts']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
    const commit = (await git(['rev-parse', 'HEAD'])).trim();
    await writeFile(join(dir, 'src/a.ts'), 'dirty\n');
    const read = await readCodingGitSnapshot(dir, commit, ['src/'], signal);
    expect(read.files).toEqual([{ path: 'src/a.ts', content: 'committed\n', mode: '100644' }]);
    expect(read.baseCommit).toBe(commit);
    await expect(readCodingGitSnapshot(dir, 'HEAD', ['src/'], signal)).rejects.toThrow('exact');
  });
  it.each(['.github', '.github/', '.github/workflows/ci.yml', '.GitHub/', ':(glob)**', ':!src/', '../secrets', './src', '/src', 'src/../secrets', 'src//file', 'src\\file', 'src/.git/config'])('rejects non-canonical Git scope %s before invoking Git', async scope => {
    await expect(readCodingGitSnapshot('/does/not/exist', sha, [scope], new AbortController().signal)).rejects.toThrow('canonical');
  });
  it.each(['file', 'directory'])('excludes top-level .github %s from coding context', async kind => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-coding-protected-')); paths.push(dir);
    const signal = new AbortController().signal;
    const git = (args: string[]) => runCodingProcess('git', args, '', signal, 4096, dir);
    await git(['init']);
    if (kind === 'directory') { await mkdir(join(dir, '.github')); await writeFile(join(dir, '.github/ci.yml'), 'protected'); }
    else await writeFile(join(dir, '.github'), 'protected');
    await git(['add', '.github']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'protected context fixture']);
    const commit = (await git(['rev-parse', 'HEAD'])).trim();
    await expect(readCodingGitSnapshot(dir, commit, ['.github'], signal)).rejects.toThrow('protected .github');
    if (kind === 'directory') await expect(readCodingGitSnapshot(dir, commit, ['.github/'], signal)).rejects.toThrow('protected .github');
  });
  it('uses literal Git pathspecs and distinguishes valid replacement characters from malformed UTF-8 bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-coding-bytes-')); paths.push(dir);
    const signal = new AbortController().signal;
    const git = (args: string[]) => runCodingProcess('git', args, '', signal, 4096, dir);
    await git(['init']); await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src/a.ts'), 'outside-literal-path');
    await writeFile(join(dir, 'src/[a].ts'), 'literal-star-file');
    await writeFile(join(dir, 'src/replacement.txt'), '\ufeffvalid \ufffd text');
    await writeFile(join(dir, 'src/invalid.txt'), Buffer.from([0x61, 0x80, 0x62]));
    await git(['add', 'src/']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'UTF-8 fixture']);
    const commit = (await git(['rev-parse', 'HEAD'])).trim();
    expect((await readCodingGitSnapshot(dir, commit, ['src/[a].ts'], signal)).files).toEqual([{ path: 'src/[a].ts', content: 'literal-star-file', mode: '100644' }]);
    expect((await readCodingGitSnapshot(dir, commit, ['src/replacement.txt'], signal)).files[0]!.content).toBe('\ufeffvalid \ufffd text');
    await expect(readCodingGitSnapshot(dir, commit, ['src/invalid.txt'], signal)).rejects.toThrow('valid UTF-8');
  });
  it.each(['info', 'image'])('preserves cancellation during Docker %s readiness probe', async phase => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-readiness-abort-')); paths.push(dir);
    const binary = join(dir, 'docker'); const marker = join(dir, 'entered');
    await writeFile(binary, `#!${process.execPath}\nif(process.argv[2]===${JSON.stringify(phase)}){require('node:fs').writeFileSync(${JSON.stringify(marker)},'entered');setInterval(()=>{},1000);}else{process.stdout.write('29.4.0');}`);
    await chmod(binary, 0o700);
    const controller = new AbortController(); const reason = new Error('operator stopped readiness');
    const pending = inspectCodingDockerReadiness(snapshot().image, controller.signal, binary);
    // Attach rejection expectation before aborting to avoid an unhandled-rejection race.
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toBe('entered'); }, { timeout: 10_000 });
    controller.abort(reason);
    await rejected;
  });
  it('uses credential only in trusted object API, blocks redirects and redacts errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sha }), { status: 201 }));
    const port = createCodingGitHubObjectsPort({ owner: 'zhinjs', repository: 'zhin', token: async () => 'private-service-token', fetch: fetcher });
    await port.createBlob('content', new AbortController().signal);
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/zhinjs/zhin/git/blobs', expect.objectContaining({ method: 'POST', redirect: 'error', body: JSON.stringify({ content: 'content', encoding: 'utf-8' }) }));
    fetcher.mockResolvedValueOnce(new Response('private-service-token', { status: 403 }));
    await expect(port.createBlob('x', new AbortController().signal)).rejects.toThrow('failed (403)');
  });
});


describe('coding executor fenced lifecycle', () => {
  const ref = { ref: 'test', revision: 1, digest: `sha256:${'1'.repeat(64)}` };
  const envelope = createAssignmentExecutionEnvelope({ projectId: 'p', runId: 'r', taskKey: 't', taskRevision: 1, assignmentId: 'a', assignmentRevision: 1, attempt: 1, fence: 1, principalId: 'agent', role: 'executor', agentDefinition: ref, plan: ref, contextPolicy: ref, capabilitySnapshot: ref, policySnapshot: ref, factAnchor: { ref: 'fact', sequence: 1, digest: ref.digest }, workspace: { leaseRef: 'lease', mountRef: 'mount', baseRevision: `git:${sha}`, fence: 1 } });
  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-docker-protocol-')); paths.push(dir);
    const binary = join(dir, 'docker');
    // This is a protocol fixture, not evidence of Docker security or model execution.
    await writeFile(binary, `#!${process.execPath}\nif(process.argv[2]==='run') process.stdout.write(JSON.stringify({edits:[{path:'src/a.ts',content:'after'}]}));`);
    await chmod(binary, 0o700);
    const snapshots = { resolve: vi.fn(async () => ({ ...snapshot(), envelopeDigest: envelope.digest })), assertCurrent: vi.fn(async () => {}), claimExecution: vi.fn(async () => {}), release: vi.fn(async () => {}) };
    const objects: CodingObjectsPort = { createBlob: vi.fn(async () => sha), createTree: vi.fn(async () => sha), createCommit: vi.fn(async () => sha) };
    const reports = { find: vi.fn(async (_digest: string, _signal: AbortSignal): Promise<{ ref: string; digest: string; report: Readonly<Record<string, unknown>> } | undefined> => undefined), save: vi.fn(async (report: Readonly<Record<string, unknown>>) => ({ ref: 'report', digest: digest(report) })) };
    return { binary, dir, snapshots, objects, reports, executor: new DockerCodingAssignmentExecutor(snapshots, objects, reports, binary) };
  }
  it.each([2_147_483_648, 4_294_967_296, Number.MAX_SAFE_INTEGER])('rejects timer-overflow budget %s before any dispatch claim', async timeoutMs => {
    const f = await fixture();
    f.snapshots.resolve.mockResolvedValueOnce({ ...snapshot(), envelopeDigest: envelope.digest, timeoutMs });
    await expect((async () => { for await (const _event of f.executor.execute(envelope, new AbortController().signal)) { /* drain */ } })()).rejects.toThrow('platform timer upper bound');
    expect(f.snapshots.claimExecution).not.toHaveBeenCalled();
  });
  it('emits exact candidate and releases operation snapshot', async () => {
    const f = await fixture(); const events = [];
    for await (const event of f.executor.execute(envelope, new AbortController().signal)) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'execution_completed', envelopeDigest: envelope.digest, completion: { candidate: { ref: `git:${sha}` } } });
    expect(f.snapshots.release).toHaveBeenCalledOnce();
  });
  it('forces daemon-side removal after timeout and releases the lease', async () => {
    const f = await fixture();
    const log = join(f.dir, 'removed');
    await writeFile(f.binary, `#!${process.execPath}\nif(process.argv[2]==='run') setInterval(()=>{},1000); else require('node:fs').writeFileSync(${JSON.stringify(log)},'removed');`);
    f.snapshots.resolve.mockResolvedValueOnce({ ...snapshot(), envelopeDigest: envelope.digest, timeoutMs: 80 });
    await expect((async () => { for await (const _event of f.executor.execute(envelope, new AbortController().signal)) { /* drain */ } })()).rejects.toThrow('aborted');
    expect(await readFile(log, 'utf8')).toBe('removed');
    expect(f.snapshots.release).toHaveBeenCalledOnce();
    expect(f.objects.createBlob).not.toHaveBeenCalled();
  });
  it('reconciles only authority-confirmed stale daemon containers', async () => {
    const f = await fixture();
    const log = join(f.dir, 'removed');
    const name = `zhin-coding-${'a'.repeat(64)}`;
    await writeFile(f.binary, `#!${process.execPath}\nif(process.argv[2]==='ps') process.stdout.write('${name}'); else require('node:fs').writeFileSync(${JSON.stringify(log)},process.argv[4]);`);
    expect(await reconcileCodingContainers(async () => false, new AbortController().signal, f.binary)).toEqual({ inspected: 1, removed: [] });
    expect(await reconcileCodingContainers(async digest => digest === 'sha256:'+'a'.repeat(64), new AbortController().signal, f.binary)).toEqual({ inspected: 1, removed: [name] });
    expect(await readFile(log, 'utf8')).toBe(name);
  });
  it('replays durable exact candidate without redispatch or object writes', async () => {
    const f = await fixture();
    const report = { envelopeDigest: envelope.digest, baseCommit: sha, commit: sha };
    f.reports.find.mockResolvedValueOnce({ ref: 'prior', digest: digest(report), report });
    const events = [];
    for await (const event of f.executor.execute(envelope, new AbortController().signal)) events.push(event);
    expect(events).toHaveLength(1);
    expect(f.snapshots.claimExecution).not.toHaveBeenCalled();
    expect(f.snapshots.release).not.toHaveBeenCalled();
    expect(f.objects.createBlob).not.toHaveBeenCalled();
  });
  it('revalidates fence after asynchronous recovered report lookup', async () => {
    const f = await fixture();
    const report = { envelopeDigest: envelope.digest, baseCommit: sha, commit: sha };
    f.reports.find.mockResolvedValueOnce({ ref: 'prior', digest: digest(report), report });
    f.snapshots.assertCurrent.mockResolvedValueOnce().mockRejectedValueOnce(new Error('stale during recovery'));
    const events = [];
    await expect((async () => { for await (const event of f.executor.execute(envelope, new AbortController().signal)) events.push(event); })()).rejects.toThrow('stale during recovery');
    expect(events).toHaveLength(0);
    expect(f.snapshots.release).not.toHaveBeenCalled();
  });
  it('refuses duplicate dispatch without a durable report', async () => {
    const f = await fixture();
    f.snapshots.claimExecution.mockRejectedValueOnce(new Error('already dispatched; reconcile'));
    await expect((async () => { for await (const _event of f.executor.execute(envelope, new AbortController().signal)) { /* drain */ } })()).rejects.toThrow('reconcile');
    expect(f.snapshots.release).not.toHaveBeenCalled();
    expect(f.objects.createBlob).not.toHaveBeenCalled();
  });
  it('rejects old fence after execution before any object upload', async () => {
    const f = await fixture();
    f.snapshots.assertCurrent.mockResolvedValueOnce().mockRejectedValueOnce(new Error('stale fence'));
    const consume = async () => { for await (const _event of f.executor.execute(envelope, new AbortController().signal)) { /* drain */ } };
    await expect(consume()).rejects.toThrow('stale fence');
    expect(f.objects.createBlob).not.toHaveBeenCalled();
    expect(f.snapshots.release).toHaveBeenCalledOnce();
  });
  it('does not publish a late receipt after cancellation during durable reporting', async () => {
    const f = await fixture(); const controller = new AbortController(); const events = [];
    f.reports.save.mockImplementationOnce(async report => { controller.abort(); return { ref: 'report', digest: digest(report) }; });
    await expect((async () => { for await (const event of f.executor.execute(envelope, controller.signal)) events.push(event); })()).rejects.toThrow();
    expect(events.some(event => event.type === 'execution_completed')).toBe(false);
    expect(f.snapshots.release).toHaveBeenCalledOnce();
  });
});
