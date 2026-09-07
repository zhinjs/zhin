#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCandidateArtifacts, readRegular, sha256 } from './candidate-artifacts.mjs';

/** Explicit operator action. Registry access occurs only when this helper is invoked. */
export function prepareCanaryLock(directory, pnpmBinary = 'pnpm') {
  const identityPath = path.join(directory, 'canary.json');
  const identity = JSON.parse(readRegular(identityPath));
  readCandidateArtifacts({ ...identity, artifactsDirectory: directory, artifactFilesDirectory: path.join(directory, 'artifacts') });
  const packagePath = path.join(directory, 'package.json');
  if (sha256(readRegular(packagePath)) !== identity.packageJsonDigest) throw new Error('Canary package manifest changed before lock preparation');
  const lockPath = path.join(directory, 'pnpm-lock.yaml');
  if (fs.existsSync(lockPath)) throw new Error('Canary lock already exists; use a fresh prepared bundle');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-canary-lock-'));
  const env = { PATH: process.env.PATH, HOME: home, CI: 'true', COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', npm_config_userconfig: path.join(home, 'empty.npmrc') };
  try {
    // No auto-download or version fallback; the operator provisions the pinned pnpm executable.
    const version = execFileSync(pnpmBinary, ['--version'], { cwd: directory, env, encoding: 'utf8', timeout: 30_000 }).trim();
    if (version !== '9.0.2') throw new Error('Canary lock requires provisioned pnpm 9.0.2');
    execFileSync(pnpmBinary, ['install', '--prod', '--lockfile-only', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: directory, env, stdio: 'inherit', timeout: 600_000 });
    readCandidateArtifacts({ ...identity, artifactsDirectory: directory, artifactFilesDirectory: path.join(directory, 'artifacts') });
    if (sha256(readRegular(packagePath)) !== identity.packageJsonDigest) throw new Error('Canary package manifest changed during lock preparation');
    const lockfile = readRegular(lockPath);
    if (!lockfile.length) throw new Error('Canary lock preparation produced an empty lock');
    const updated = { ...identity, lockfileDigest: sha256(lockfile) };
    fs.writeFileSync(identityPath, JSON.stringify(updated, null, 2));
    return updated;
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(prepareCanaryLock(path.dirname(fileURLToPath(import.meta.url)), process.argv[2] ?? 'pnpm')));
}
