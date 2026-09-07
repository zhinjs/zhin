#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspacePackClosure } from './workspace-pack-closure.mjs';
import { verifyInstalledSmokeReceipt } from './self-delivery-smoke-receipt.mjs';

const [mode, directory, output] = process.argv.slice(2);
const trustedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['zhin.js', '@zhin.js/agent', '@zhin.js/runtime', '@zhin.js/satori'];
const sha256 = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const run = (args, cwd) => execFileSync('pnpm', args, { cwd, stdio: 'inherit', timeout: 600_000 });
if (mode === 'validate') {
  const names = fs.readdirSync(directory);
  if (!names.includes('manifest.json') || names.length > 500) throw new Error('Invalid artifact directory');
  let total = 0;
  for (const name of names) {
    const stat = fs.lstatSync(path.join(directory, name));
    if (!/^(manifest\.json|[\w.-]+\.tgz)$/.test(name) || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Artifact contains unsafe filesystem entry');
    total += stat.size;
  }
  if (total > 512 * 1024 * 1024) throw new Error('Artifact exceeds upload budget');
} else if (mode === 'pack') {
  if (!/^[a-f0-9]{40}$/.test(process.env.CANDIDATE_SHA ?? '')) throw new Error('Missing candidate SHA');
  const entries = JSON.parse(execFileSync('pnpm', ['list', '-r', '--depth', '-1', '--json'], { cwd: directory, encoding: 'utf8' }));
  const packages = entries.map(entry => ({ name: entry.name, directory: entry.path, manifest: JSON.parse(fs.readFileSync(path.join(entry.path, 'package.json'), 'utf8')) }));
  const closure = resolveWorkspacePackClosure(packages, roots);
  fs.mkdirSync(output, { recursive: true });
  const artifacts = [];
  for (const item of closure) {
    const before = new Set(fs.readdirSync(output));
    run(['pack', '--pack-destination', path.resolve(output)], item.directory);
    const files = fs.readdirSync(output).filter(name => name.endsWith('.tgz') && !before.has(name));
    if (files.length !== 1) throw new Error(`Expected one tarball for ${item.name}`);
    const file = files[0];
    artifacts.push({ name: item.name, version: item.manifest.version, file, digest: sha256(fs.readFileSync(path.join(output, file))) });
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, candidateSha: process.env.CANDIDATE_SHA, runId: process.env.BUILD_RUN_ID, runAttempt: process.env.BUILD_RUN_ATTEMPT, artifacts }, null, 2));
} else if (mode === 'smoke') {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.candidateSha !== process.env.CANDIDATE_SHA || !Array.isArray(manifest.artifacts)) throw new Error('Candidate manifest binding mismatch');
  const overrides = {};
  for (const artifact of manifest.artifacts) {
    if (!/^[\w.-]+\.tgz$/.test(artifact.file) || typeof artifact.name !== 'string' || Object.hasOwn(overrides, artifact.name)) throw new Error('Invalid candidate manifest entry');
    const file = path.resolve(directory, artifact.file);
    if (sha256(fs.readFileSync(file)) !== artifact.digest) throw new Error('Tarball digest mismatch');
    overrides[artifact.name] = 'file:' + file;
  }
  if (roots.some(name => !Object.hasOwn(overrides, name))) throw new Error('Candidate package closure incomplete');
  fs.cpSync(path.join(trustedRoot, 'examples/minimal-bot'), output, { recursive: true, filter: source => !['node_modules', 'tests', 'lib', '.zhin', '.data'].includes(path.basename(source)) });
  const fixture = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  fixture.dependencies = Object.fromEntries(roots.map(name => [name, overrides[name]]));
  fixture.devDependencies = {};
  fixture.pnpm = { overrides };
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify(fixture, null, 2));
  run(['install', '--prod', '--ignore-scripts', '--store-dir', path.join(output, '.store')], output);
  fs.copyFileSync(path.join(trustedRoot, 'scripts/self-delivery-installed-smoke.mjs'), path.join(output, 'smoke.mjs'));
  const receiptPath = path.join(output, 'smoke-result.json');
  fs.rmSync(receiptPath, { force: true });
  execFileSync(process.execPath, ['--experimental-transform-types', 'smoke.mjs'], { cwd: output, stdio: 'inherit', timeout: 120_000 });
  // Exit 0 alone is not evidence: a package may terminate during module initialization.
  const receipt = verifyInstalledSmokeReceipt(receiptPath, process.env.CANDIDATE_SHA, process.env.ARTIFACT_DIGEST);
  console.log(JSON.stringify({ type: 'self-delivery-smoke-receipt', ...receipt }));
} else throw new Error('Expected pack or smoke');
