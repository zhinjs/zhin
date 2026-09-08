import fs, { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCanaryBundle } from '../../deploy/huggingface-canary/build-bundle.mjs';
import { readRegular } from '../../deploy/huggingface-canary/candidate-artifacts.mjs';
import { prepareCanaryLock } from '../../deploy/huggingface-canary/prepare-lock.mjs';
const dirs: string[] = [];
const digest = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
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
    writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='--version'){console.log('9.0.2');}else{const p=JSON.parse(fs.readFileSync('package.json'));fs.writeFileSync('pnpm-lock.yaml',JSON.stringify({dependencies:p.dependencies,overrides:p.pnpm.overrides,args:process.argv.slice(2),userConfig:fs.readFileSync(process.env.npm_config_userconfig,'utf8'),globalConfig:fs.readFileSync(process.env.npm_config_globalconfig,'utf8'),distinctConfigs:process.env.npm_config_userconfig!==process.env.npm_config_globalconfig}));}`);
    chmodSync(binary, 0o700);
    const result = prepareCanaryLock(options.outputDirectory, binary);
    const lock = JSON.parse(readFileSync(join(options.outputDirectory, 'pnpm-lock.yaml'), 'utf8'));
    expect(lock.userConfig).toBe('');
    expect(lock.globalConfig).toBe('');
    expect(lock.distinctConfigs).toBe(true);
    expect(lock.dependencies['zhin.js']).toBe('file:artifacts/0.tgz');
    expect(Object.values(lock.overrides).every(value => String(value).startsWith('file:artifacts/'))).toBe(true);
    expect(lock.args).toEqual(expect.arrayContaining(['--lockfile-only', '--ignore-scripts', '--ignore-pnpmfile', '--no-frozen-lockfile']));
    expect(result.lockfileDigest).toBe(digest(readFileSync(join(options.outputDirectory, 'pnpm-lock.yaml'))));
    expect(() => prepareCanaryLock(options.outputDirectory, binary)).toThrow('already exists');
  });
  it.each([undefined, '', '   ', '\t\n'])('rejects absent or blank frozen lockfile path %j before creating the bundle', lockfilePath => {
    const { options } = fixture();
    expect(() => buildCanaryBundle({ ...options, lockfilePath })).toThrow('Canary requires dependency lockfile path');
    expect(existsSync(options.outputDirectory)).toBe(false);
  });
  it.each(['', '   ', '\t\n'])('allows blank unused lockfile path %j in prepare-lock mode', lockfilePath => {
    const { options } = fixture();
    const prepared = buildCanaryBundle({ ...options, lockfilePath }, 'prepare-lock');
    expect(prepared.lockfileDigest).toBeNull();
    expect(existsSync(join(options.outputDirectory, 'pnpm-lock.yaml'))).toBe(false);
  });
  it.each(['subprocess', 'validation'])('removes uncommitted lock after %s failure and preserves identity', failure => {
    const { options } = fixture();
    buildCanaryBundle({ ...options, lockfilePath: undefined }, 'prepare-lock');
    const identityPath = join(options.outputDirectory, 'canary.json');
    const before = readFileSync(identityPath, 'utf8');
    const binary = join(options.artifactsDirectory, 'failing-pnpm');
    const effect = failure === 'subprocess' ? 'process.exit(2);' : "fs.appendFileSync('package.json',' ');";
    writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='--version'){console.log('9.0.2');}else{fs.writeFileSync('pnpm-lock.yaml','incomplete');${effect}}`);
    chmodSync(binary, 0o700);
    expect(() => prepareCanaryLock(options.outputDirectory, binary)).toThrow();
    expect(readFileSync(identityPath, 'utf8')).toBe(before);
    expect(existsSync(join(options.outputDirectory, 'pnpm-lock.yaml'))).toBe(false);
    expect(existsSync(join(options.outputDirectory, '.prepare-lock.claim'))).toBe(false);
  });
  it('preserves a lock committed before this invocation acquires its preparation claim', () => {
    const { options } = fixture();
    buildCanaryBundle({ ...options, lockfilePath: undefined }, 'prepare-lock');
    const lock = join(options.outputDirectory, 'pnpm-lock.yaml');
    const claim = join(options.outputDirectory, '.prepare-lock.claim');
    const realOpen = fs.openSync.bind(fs);
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
      if (file === claim) writeFileSync(lock, 'concurrent winner');
      return realOpen(file, flags, mode);
    });
    expect(() => prepareCanaryLock(options.outputDirectory, '/must/not/run')).toThrow('already exists');
    expect(readFileSync(lock, 'utf8')).toBe('concurrent winner');
    expect(existsSync(claim)).toBe(false);
  });
  it.each(['node:240', 'node:241-bookworm', 'node:24evil'])('rejects non-Node-24 tag %s', tag => {
    const { options } = fixture();
    expect(() => buildCanaryBundle({ ...options, nodeImage: `${tag}@sha256:${'b'.repeat(64)}` })).toThrow('pinned Node 24');
  });
  it('rejects a path replaced by a symlink between inspection and opening', () => {
    const { options } = fixture();
    const file = join(options.artifactsDirectory, '0.tgz');
    const realOpen = fs.openSync.bind(fs);
    vi.spyOn(fs, 'openSync').mockImplementationOnce((target, flags, mode) => {
      rmSync(file);
      symlinkSync('1.tgz', file);
      return realOpen(target, flags, mode);
    });
    expect(() => readRegular(file)).toThrow();
  });
  it('rejects a manifest that actually omits a required candidate package', () => {
    const { options, manifest } = fixture();
    manifest.artifacts = manifest.artifacts.filter(artifact => artifact.name !== '@zhin.js/agent');
    const bytes = JSON.stringify(manifest);
    writeFileSync(join(options.artifactsDirectory, 'manifest.json'), bytes);
    expect(() => buildCanaryBundle({ ...options, manifestDigest: digest(bytes) })).toThrow('closure incomplete');
    expect(existsSync(options.outputDirectory)).toBe(false);
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
  it('rejects duplicate package identities', () => {
    const { options, manifest } = fixture();
    manifest.artifacts[1]!.name = manifest.artifacts[0]!.name;
    const bytes = JSON.stringify(manifest); writeFileSync(join(options.artifactsDirectory, 'manifest.json'), bytes);
    expect(() => buildCanaryBundle({ ...options, manifestDigest: digest(bytes) })).toThrow('artifact');
  });
});
