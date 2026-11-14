// `zhin doctor` loads node-pty the way the project's gateway would, in a child process (#1250).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nativeModuleFixCommand, probeGatewayNativeModule, usesPnpm } from '../../src/utils/native-build-deps.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writePackage(dir: string, manifest: Record<string, unknown>, files: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

/** A project whose gateway (an ESM-only package, like the real one) has `node-pty` next to it. */
function project(nodePty: 'loads' | 'broken' | 'missing', withGateway = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-probe-'));
  roots.push(root);
  writePackage(root, { name: 'bot', private: true }, {});
  if (!withGateway) return root;
  const gateway = path.join(root, 'node_modules', '@zhin.js', 'gateway');
  writePackage(gateway, { name: '@zhin.js/gateway', type: 'module', exports: { '.': { import: './lib/index.js' } } }, {});
  fs.mkdirSync(path.join(gateway, 'lib'));
  fs.writeFileSync(path.join(gateway, 'lib', 'index.js'), 'export {};\n');
  if (nodePty === 'missing') return root;
  // Installed next to the gateway, as pnpm lays out an optional dependency (not in the project's root).
  writePackage(path.join(gateway, 'node_modules', 'node-pty'), { name: 'node-pty', main: 'index.js' }, {
    'index.js': nodePty === 'loads'
      ? 'module.exports = { spawn() {} };\n'
      : "throw new Error(\"Cannot find module '../build/Release/pty.node'\");\n",
  });
  return root;
}

describe('probeGatewayNativeModule', () => {
  it('reports ok when node-pty loads from the gateway location', async () => {
    await expect(probeGatewayNativeModule(project('loads'))).resolves.toEqual({ status: 'ok' });
  });

  it('reports the load error when the native binding was not built', async () => {
    const probe = await probeGatewayNativeModule(project('broken'));
    expect(probe).toEqual({ status: 'failed', reason: expect.stringContaining('pty.node') });
  });

  it('reports a missing node-pty as a failure', async () => {
    const probe = await probeGatewayNativeModule(project('missing'));
    expect(probe.status).toBe('failed');
    expect(probe.status === 'failed' && probe.reason).toContain('node-pty');
  });

  it('skips projects without the gateway', async () => {
    await expect(probeGatewayNativeModule(project('loads', false))).resolves.toEqual({ status: 'no-gateway' });
  });
});

describe('nativeModuleFixCommand', () => {
  it('points pnpm projects at allowBuilds and pnpm rebuild, npm projects at npm rebuild', () => {
    const root = project('loads', false);
    expect(usesPnpm(root, {})).toBe(true);
    expect(nativeModuleFixCommand(root, {})).toContain('allowBuilds: { node-pty: true }');
    expect(nativeModuleFixCommand(root, {})).toContain('pnpm rebuild node-pty');
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    expect(nativeModuleFixCommand(root, {})).toContain('npm rebuild node-pty');
    expect(nativeModuleFixCommand(root, { packageManager: 'pnpm@11.27.1' })).toContain('pnpm rebuild node-pty');
  });
});
