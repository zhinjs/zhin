import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  caretRangeFromVersion,
  collectStackVersionRanges,
  findZhinWorkspaceRoot,
  loadStackVersionRanges,
  scaffoldDependencyRange,
  withScaffoldVersionRanges,
} from '../src/stack-version-ranges.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeManifest(root: string, directory: string, manifest: Record<string, unknown>): void {
  const packageDirectory = path.join(root, directory);
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify(manifest));
}

function createFakeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-stack-ranges-'));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/im/*'\n  - 'packages/toolkit/*'\n  - 'examples/*'\n");
  writeManifest(root, 'packages/im/zhin', { name: 'zhin.js', version: '1.1.11' });
  writeManifest(root, 'packages/im/ai', {
    name: '@zhin.js/ai',
    version: '1.1.36',
    peerDependencies: { ai: '^7.0.0', zod: '^4.0.0', '@zhin.js/core': 'workspace:^' },
  });
  writeManifest(root, 'packages/im/agent', {
    name: '@zhin.js/agent',
    version: '1.1.14-beta.2',
    peerDependencies: { '@modelcontextprotocol/sdk': '^1.29.0', zod: '^3.0.0' },
  });
  writeManifest(root, 'packages/toolkit/scaffold-wizard', { name: '@zhin.js/scaffold-wizard', version: '1.1.6' });
  writeManifest(root, 'examples/minimal-bot', { name: '@zhin.js/example-minimal-bot', version: '0.0.1', private: true });
  writeManifest(root, 'packages/toolkit/other', { name: 'third-party-tool', version: '2.0.0' });
  return root;
}

describe('stack version ranges', () => {
  it('turns release versions into caret ranges and rejects everything else', () => {
    expect(caretRangeFromVersion('1.1.11')).toBe('^1.1.11');
    expect(caretRangeFromVersion('1.1.14-beta.2')).toBe('^1.1.14-beta.2');
    expect(caretRangeFromVersion('latest')).toBeUndefined();
    expect(caretRangeFromVersion('workspace:*')).toBeUndefined();
    expect(caretRangeFromVersion(undefined)).toBeUndefined();
  });

  it('collects published Zhin packages and the third-party AI ranges Zhin declares as peers', () => {
    const root = createFakeWorkspace();

    const ranges = collectStackVersionRanges(root);

    expect(ranges).toEqual({
      '@modelcontextprotocol/sdk': '^1.29.0',
      '@zhin.js/agent': '^1.1.14-beta.2',
      '@zhin.js/ai': '^1.1.36',
      '@zhin.js/scaffold-wizard': '^1.1.6',
      ai: '^7.0.0',
      'zhin.js': '^1.1.11',
      zod: '^4.0.0',
    });
  });

  it('replaces only latest entries that have a derived range', () => {
    const ranges = { 'zhin.js': '^1.1.11', ai: '^7.0.0' };

    const resolved = withScaffoldVersionRanges({
      'zhin.js': 'latest',
      ai: 'latest',
      '@icqqjs/icqq': 'latest',
      sqlite3: '^5.1.7',
    }, ranges);

    expect(resolved).toEqual({
      'zhin.js': '^1.1.11',
      ai: '^7.0.0',
      '@icqqjs/icqq': 'latest',
      sqlite3: '^5.1.7',
    });
    expect(scaffoldDependencyRange('unknown-package', ranges)).toBe('latest');
  });

  it('reads the live monorepo versions when running from a checkout', () => {
    const workspaceRoot = findZhinWorkspaceRoot(__dirname);
    expect(workspaceRoot).toBeDefined();
    const zhinManifest = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot!, 'packages/im/zhin/package.json'), 'utf8'),
    ) as { version: string };

    const ranges = loadStackVersionRanges();

    expect(ranges['zhin.js']).toBe(`^${zhinManifest.version}`);
    expect(ranges['@zhin.js/cli']).toMatch(/^\^\d+\.\d+\.\d+/u);
    expect(Object.values(ranges)).not.toContain('latest');
  });
});
