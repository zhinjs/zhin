import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pubCommand, runPrePublishCheck } from '../src/commands/pub.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createPlugin(manifest: Record<string, unknown>, files: Record<string, string> = {}): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-pub-check-'));
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
  return directory;
}

describe('zhin pub pre-publish check', () => {
  it('offers --skip-check', () => {
    const flags = pubCommand.options.map((option) => option.long);
    expect(flags).toContain('--skip-check');
  });

  it('blocks publishing when plugin check reports errors', async () => {
    const directory = createPlugin({
      name: 'zhin.js-broken',
      version: '0.0.0',
      type: 'module',
      files: ['plugin.js'],
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [], plugins: [] },
    }, { 'plugin.ts': 'export default {};\n' });

    await expect(runPrePublishCheck(directory)).resolves.toBe(false);
  }, 60_000);

  it('lets a plugin with only warnings through', async () => {
    const directory = createPlugin({
      name: 'zhin.js-fine',
      version: '0.0.0',
      type: 'module',
      main: './plugin.js',
      files: ['plugin.js', 'README.md'],
      peerDependencies: { 'zhin.js': '^1.0.0' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', engine: '^1.0.0', features: [], plugins: [] },
    }, { 'plugin.js': 'export default {};\n', 'README.md': '# fine\n' });

    await expect(runPrePublishCheck(directory)).resolves.toBe(true);
  }, 60_000);
});
