import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRuntimeRoot = fileURLToPath(new URL('../../../src/plugin-runtime/', import.meta.url));

describe('start process module boundary', () => {
  it('keeps process startup internals behind the module entry point', async () => {
    const entries = await readdir(pluginRuntimeRoot, { withFileTypes: true });
    const rootSources = entries.filter(entry => entry.isFile() && entry.name.endsWith('.ts'));
    const violations: string[] = [];

    for (const entry of rootSources) {
      const source = await readFile(new URL(`../../../src/plugin-runtime/${entry.name}`, import.meta.url), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\()['"]\.\/start\/([^'"]+)/gu)) {
        if (match[1] !== 'module.js') violations.push(`${entry.name} -> ${match[1]}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
