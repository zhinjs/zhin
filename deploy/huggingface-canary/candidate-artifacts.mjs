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
  const expected = fs.lstatSync(file);
  if (!expected.isFile() || expected.isSymbolicLink() || expected.size > 512 * 1024 * 1024) throw new Error('Canary requires bounded regular files');
  // Bind validation and reads to one descriptor. NOFOLLOW prevents last-component
  // symlink races; inode/device checks also cover platforms without that flag.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino || opened.size !== expected.size) throw new Error('Canary artifact changed during open');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('Canary artifact truncated during read');
      offset += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset)) throw new Error('Canary artifact grew during read');
    return bytes;
  } finally { fs.closeSync(fd); }
}
