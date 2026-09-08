#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { readCandidateArtifacts, readRegular, sha256 } from './candidate-artifacts.mjs';
const required = ['zhin.js', '@zhin.js/agent', '@zhin.js/runtime', '@zhin.js/satori'];

/** Pure local preparation. No registry, Docker, HF, git or service credential access. */
export function buildCanaryBundle(options, mode = 'frozen') {
  if (!['frozen', 'prepare-lock'].includes(mode)) throw new Error('Unknown canary preparation mode');
  const { outputDirectory, candidateSha, manifestDigest, runId, runAttempt, nodeImage, lockfilePath } = options;
  if (!/^[a-f0-9]{40}$/.test(candidateSha) || !/^sha256:[a-f0-9]{64}$/.test(manifestDigest) || !/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) throw new Error('Canary requires exact candidate and build identity');
  if (!/^node:24(?:[.-][\w.-]+)?@sha256:[a-f0-9]{64}$/.test(nodeImage)) throw new Error('Canary requires pinned Node 24 image digest');
  if (fs.existsSync(outputDirectory)) throw new Error('Canary output must be a new directory');
  const { bytes, manifest, files, overrides } = readCandidateArtifacts(options);
  // Must be produced/verified by trusted candidate smoke; frozen installation fails on mismatch.
  if (mode !== 'prepare-lock' && (typeof lockfilePath !== 'string' || !lockfilePath.trim())) throw new Error('Canary requires dependency lockfile path');
  const lockfile = mode === 'prepare-lock' ? undefined : readRegular(lockfilePath);
  if (lockfile && !lockfile.length) throw new Error('Canary requires dependency lockfile');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.mkdirSync(path.join(outputDirectory, 'artifacts'));
  for (const [file, contents] of files) fs.writeFileSync(path.join(outputDirectory, 'artifacts', file), contents);
  fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), bytes);
  if (lockfile) fs.writeFileSync(path.join(outputDirectory, 'pnpm-lock.yaml'), lockfile);
  for (const name of ['plugin.ts', 'commands', 'adapters', 'tools', 'components', 'agents']) fs.cpSync(path.join(root, 'examples/minimal-bot', name), path.join(outputDirectory, name), { recursive: true });
  const template = JSON.parse(fs.readFileSync(path.join(root, 'examples/minimal-bot/package.json')));
  template.name = 'zhin-self-delivery-canary'; template.scripts = {}; template.devDependencies = {};
  template.dependencies = Object.fromEntries(required.map(name => [name, overrides[name]])); template.pnpm = { overrides }; template.packageManager = 'pnpm@9.0.2';
  fs.writeFileSync(path.join(outputDirectory, 'package.json'), JSON.stringify(template, null, 2));
  const identity = { version: 1, candidateSha, manifestDigest, runId, runAttempt, lockfileDigest: lockfile ? sha256(lockfile) : null, packageJsonDigest: sha256(fs.readFileSync(path.join(outputDirectory, 'package.json'))), packages: manifest.artifacts.map(({ name, version, digest }) => ({ name, version, digest })) };
  fs.writeFileSync(path.join(outputDirectory, 'canary.json'), JSON.stringify(identity, null, 2));
  for (const script of ['server.mjs', 'prepare-lock.mjs', 'candidate-artifacts.mjs']) fs.copyFileSync(path.join(root, 'deploy/huggingface-canary', script), path.join(outputDirectory, script));
  fs.writeFileSync(path.join(outputDirectory, 'Dockerfile'), `FROM ${nodeImage}\nRUN corepack enable && corepack prepare pnpm@9.0.2 --activate\nWORKDIR /app\nCOPY --chown=node:node . /app\nUSER node\nRUN pnpm install --prod --ignore-scripts --frozen-lockfile\nENV NODE_ENV=production PORT=7860\nEXPOSE 7860\nCMD ["node", "--experimental-transform-types", "server.mjs"]\n`);
  fs.writeFileSync(path.join(outputDirectory, 'README.md'), '---\ntitle: Zhin Candidate Canary\nsdk: docker\napp_port: 7860\n---\nDisposable candidate runtime. No control-plane journal or service credentials.\n');
  return identity;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2] === 'prepare-lock' ? 'prepare-lock' : 'frozen';
  const config = JSON.parse(fs.readFileSync(process.argv[mode === 'prepare-lock' ? 3 : 2], 'utf8'));
  console.log(JSON.stringify(buildCanaryBundle(config, mode)));
  if (mode === 'prepare-lock') console.log('Explicit next step: node ' + path.join(config.outputDirectory, 'prepare-lock.mjs'));
}
