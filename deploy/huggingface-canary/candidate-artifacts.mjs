import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const required = ['zhin.js', '@zhin.js/agent', '@zhin.js/runtime', '@zhin.js/satori'];
export function readCandidateArtifacts(options) {
  const { artifactsDirectory, candidateSha, manifestDigest, runId, runAttempt } = options;
  const manifestFile = path.join(artifactsDirectory, 'manifest.json');
  const bytes = readRegular(manifestFile);
  if (sha256(bytes) !== manifestDigest) throw new Error('Canary manifest digest mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.version !== 1 || manifest.candidateSha !== candidateSha || manifest.runId !== runId || manifest.runAttempt !== runAttempt || !Array.isArray(manifest.artifacts)) throw new Error('Canary build provenance mismatch');
  const names = new Set(); const files = new Map(); const overrides = {};
  for (const artifact of manifest.artifacts) {
    if (typeof artifact.name !== 'string' || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(artifact.name) || !/^[a-zA-Z0-9_.-]+\.tgz$/.test(artifact.file) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(artifact.version) || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest) || names.has(artifact.name) || files.has(artifact.file)) throw new Error('Invalid canary artifact');
    const contents = readRegular(path.join(options.artifactFilesDirectory ?? artifactsDirectory, artifact.file));
    if (sha256(contents) !== artifact.digest) throw new Error('Canary tarball digest mismatch');
    names.add(artifact.name); files.set(artifact.file, contents);
    overrides[artifact.name] = `file:artifacts/${artifact.file}`;
  }
  if (required.some(name => !names.has(name))) throw new Error('Canary candidate package closure incomplete');
  return { bytes, manifest, files, overrides };
}
export function readRegular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024 * 1024) throw new Error('Canary requires bounded regular files');
  return fs.readFileSync(file);
}
