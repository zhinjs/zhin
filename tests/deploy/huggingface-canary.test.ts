import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCanaryBundle } from '../../deploy/huggingface-canary/build-bundle.mjs';
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
    expect(docker).toContain(options.nodeImage); expect(docker).toContain('--frozen-lockfile'); expect(docker).toContain('USER node');
    const pkg = JSON.parse(readFileSync(join(options.outputDirectory, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.pnpm.overrides)).toHaveLength(4);
    expect(pkg.dependencies['zhin.js']).toBe('file:artifacts/0.tgz');
    expect(readFileSync(join(options.outputDirectory, 'server.mjs'), 'utf8')).toContain("sandboxRoundTrip: 'not-tested'");
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
