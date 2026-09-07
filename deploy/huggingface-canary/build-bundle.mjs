#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const required = ['zhin.js', '@zhin.js/agent', '@zhin.js/runtime', '@zhin.js/satori'];

/** Pure local preparation. No registry, Docker, HF, git or service credential access. */
export function buildCanaryBundle(options) {
  const { artifactsDirectory, outputDirectory, candidateSha, manifestDigest, runId, runAttempt, nodeImage, lockfilePath } = options;
  if (!/^[a-f0-9]{40}$/.test(candidateSha) || !/^sha256:[a-f0-9]{64}$/.test(manifestDigest) || !/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) throw new Error('Canary requires exact candidate and build identity');
  if (!/^node:24[\w.-]*@sha256:[a-f0-9]{64}$/.test(nodeImage)) throw new Error('Canary requires pinned Node 24 image digest');
  if (fs.existsSync(outputDirectory)) throw new Error('Canary output must be a new directory');
  const manifestFile = path.join(artifactsDirectory, 'manifest.json');
  const bytes = readRegular(manifestFile);
  if (sha256(bytes) !== manifestDigest) throw new Error('Canary manifest digest mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.version !== 1 || manifest.candidateSha !== candidateSha || manifest.runId !== runId || manifest.runAttempt !== runAttempt || !Array.isArray(manifest.artifacts)) throw new Error('Canary build provenance mismatch');
  const names = new Set(); const files = new Map(); const overrides = {};
  for (const artifact of manifest.artifacts) {
    if (typeof artifact.name !== 'string' || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(artifact.name) || !/^[a-zA-Z0-9_.-]+\.tgz$/.test(artifact.file) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(artifact.version) || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest) || names.has(artifact.name) || files.has(artifact.file)) throw new Error('Invalid canary artifact');
    const contents = readRegular(path.join(artifactsDirectory, artifact.file));
    if (sha256(contents) !== artifact.digest) throw new Error('Canary tarball digest mismatch');
    names.add(artifact.name); files.set(artifact.file, contents);
    overrides[artifact.name] = `file:artifacts/${artifact.file}`;
  }
  if (required.some(name => !names.has(name))) throw new Error('Canary candidate package closure incomplete');
  // Must be produced/verified by trusted candidate smoke; frozen installation fails on mismatch.
  const lockfile = readRegular(lockfilePath);
  if (!lockfile.length) throw new Error('Canary requires dependency lockfile');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.mkdirSync(path.join(outputDirectory, 'artifacts'));
  for (const [file, contents] of files) fs.writeFileSync(path.join(outputDirectory, 'artifacts', file), contents);
  fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), bytes);
  fs.writeFileSync(path.join(outputDirectory, 'pnpm-lock.yaml'), lockfile);
  for (const name of ['plugin.ts', 'commands', 'adapters', 'tools', 'components', 'agents']) fs.cpSync(path.join(root, 'examples/minimal-bot', name), path.join(outputDirectory, name), { recursive: true });
  const template = JSON.parse(fs.readFileSync(path.join(root, 'examples/minimal-bot/package.json')));
  template.name = 'zhin-self-delivery-canary'; template.scripts = {}; template.devDependencies = {};
  template.dependencies = Object.fromEntries(required.map(name => [name, overrides[name]])); template.pnpm = { overrides }; template.packageManager = 'pnpm@9.0.2';
  fs.writeFileSync(path.join(outputDirectory, 'package.json'), JSON.stringify(template, null, 2));
  const identity = { version: 1, candidateSha, manifestDigest, runId, runAttempt, lockfileDigest: sha256(lockfile), packages: manifest.artifacts.map(({ name, version, digest }) => ({ name, version, digest })) };
  fs.writeFileSync(path.join(outputDirectory, 'canary.json'), JSON.stringify(identity, null, 2));
  fs.copyFileSync(path.join(root, 'deploy/huggingface-canary/server.mjs'), path.join(outputDirectory, 'server.mjs'));
  fs.writeFileSync(path.join(outputDirectory, 'Dockerfile'), `FROM ${nodeImage}\nRUN corepack enable && corepack prepare pnpm@9.0.2 --activate\nWORKDIR /app\nCOPY --chown=node:node . /app\nUSER node\nRUN pnpm install --prod --ignore-scripts --frozen-lockfile\nENV NODE_ENV=production PORT=7860\nEXPOSE 7860\nCMD ["node", "--experimental-strip-types", "server.mjs"]\n`);
  fs.writeFileSync(path.join(outputDirectory, 'README.md'), '---\ntitle: Zhin Candidate Canary\nsdk: docker\napp_port: 7860\n---\nDisposable candidate runtime. No control-plane journal or service credentials.\n');
  return identity;
}
function readRegular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024 * 1024) throw new Error('Canary requires bounded regular files');
  return fs.readFileSync(file);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(buildCanaryBundle(config)));
}
