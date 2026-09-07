import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCanaryBundle } from '../../deploy/huggingface-canary/build-bundle.mjs';
import { prepareCanaryLock } from '../../deploy/huggingface-canary/prepare-lock.mjs';
const dirs: string[] = [];
const digest = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-canary-')); dirs.push(dir);
  const candidateSha = 'a'.repeat(40);
  const artifacts = ['zhin.js', '@zhin.js/agent', '@zhin.js/runtime', '@zhin.js/satori'].map((name, index) => ({ name, version: '1.1.23', file: `${index}.tgz`, digest: digest(name) }));
  for (const artifact of artifacts) writeFileSync(join(dir, artifact.file), artifact.name);
  const manifest = { version: 1, candidateSha, runId: '123', runAttempt: '2', artifacts };
  const bytes = JSON.stringify(manifest); writeFileSync(join(dir, 'manifest.json'), bytes);
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  return { manifest, options: { artifactsDirectory: dir, outputDirectory: join(dir, 'bundle'), candidateSha, manifestDigest: digest(bytes), runId: '123', runAttempt: '2', nodeImage: `node:24-bookworm-slim@sha256:${'b'.repeat(64)}`, lockfilePath: join(dir, 'pnpm-lock.yaml') } };
}
describe('HF canary local bundle', () => {
  it('copies exact candidate package bytes and pins frozen install and base image', () => {
    const { options, manifest } = fixture(); const result = buildCanaryBundle(options);
    expect(result.candidateSha).toBe(options.candidateSha);
    for (const artifact of manifest.artifacts) expect(digest(readFileSync(join(options.outputDirectory, 'artifacts', artifact.file)))).toBe(artifact.digest);
    const docker = readFileSync(join(options.outputDirectory, 'Dockerfile'), 'utf8');
    expect(docker).toContain(options.nodeImage); expect(docker).toContain('--frozen-lockfile'); expect(docker).toContain('USER node'); expect(docker).toContain('--experimental-transform-types');
    const pkg = JSON.parse(readFileSync(join(options.outputDirectory, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.pnpm.overrides)).toHaveLength(4);
    expect(pkg.dependencies['zhin.js']).toBe('file:artifacts/0.tgz');
    expect(readFileSync(join(options.outputDirectory, 'server.mjs'), 'utf8')).toContain("sandboxRoundTrip: 'not-tested'");
  });
  it('prepares the same relative package paths without a seed lock or network, then explicitly creates the matching lock', () => {
    const { options } = fixture();
    const prepared = buildCanaryBundle({ ...options, lockfilePath: undefined }, 'prepare-lock');
    expect(prepared.lockfileDigest).toBeNull();
    expect(existsSync(join(options.outputDirectory, 'pnpm-lock.yaml'))).toBe(false);
    const binary = join(options.artifactsDirectory, 'test-pnpm');
    // Real subprocess protocol test, no registry access and no claim of package installation.
    writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='--version'){console.log('9.0.2');}else{const p=JSON.parse(fs.readFileSync('package.json'));fs.writeFileSync('pnpm-lock.yaml',JSON.stringify({dependencies:p.dependencies,overrides:p.pnpm.overrides,args:process.argv.slice(2)}));}`);
    chmodSync(binary, 0o700);
    const result = prepareCanaryLock(options.outputDirectory, binary);
    const lock = JSON.parse(readFileSync(join(options.outputDirectory, 'pnpm-lock.yaml'), 'utf8'));
    expect(lock.dependencies['zhin.js']).toBe('file:artifacts/0.tgz');
    expect(Object.values(lock.overrides).every(value => String(value).startsWith('file:artifacts/'))).toBe(true);
    expect(lock.args).toEqual(expect.arrayContaining(['--lockfile-only', '--ignore-scripts', '--no-frozen-lockfile']));
    expect(result.lockfileDigest).toBe(digest(readFileSync(join(options.outputDirectory, 'pnpm-lock.yaml'))));
    expect(() => prepareCanaryLock(options.outputDirectory, binary)).toThrow('already exists');
  });
  it('reuses provenance validation and rejects tampering before invoking lock preparation', () => {
    const { options } = fixture();
    buildCanaryBundle({ ...options, lockfilePath: undefined }, 'prepare-lock');
    writeFileSync(join(options.outputDirectory, 'artifacts', '0.tgz'), 'changed');
    expect(() => prepareCanaryLock(options.outputDirectory, '/does/not/exist')).toThrow('digest');
  });
  it.each(['candidateSha', 'runId', 'runAttempt', 'manifestDigest'] as const)('rejects wrong %s provenance', key => {
    const { options } = fixture();
    expect(() => buildCanaryBundle({ ...options, [key]: key === 'candidateSha' ? 'c'.repeat(40) : key === 'manifestDigest' ? `sha256:${'c'.repeat(64)}` : '99' })).toThrow();
  });
  it('rejects mutable image tags, modified bytes and symlink artifacts', () => {
    const { options } = fixture();
    expect(() => buildCanaryBundle({ ...options, nodeImage: 'node:latest' })).toThrow('pinned');
    writeFileSync(join(options.artifactsDirectory, '0.tgz'), 'tampered');
    expect(() => buildCanaryBundle(options)).toThrow('digest');
    rmSync(join(options.artifactsDirectory, '0.tgz')); symlinkSync('1.tgz', join(options.artifactsDirectory, '0.tgz'));
    expect(() => buildCanaryBundle(options)).toThrow('regular');
  });
  it('rejects duplicate package identities and incomplete closure', () => {
    const { options, manifest } = fixture();
    manifest.artifacts[1]!.name = manifest.artifacts[0]!.name;
    const bytes = JSON.stringify(manifest); writeFileSync(join(options.artifactsDirectory, 'manifest.json'), bytes);
    expect(() => buildCanaryBundle({ ...options, manifestDigest: digest(bytes) })).toThrow('artifact');
  });
});
