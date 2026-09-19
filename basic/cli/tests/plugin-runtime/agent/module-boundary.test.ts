import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRuntimeRoot = fileURLToPath(new URL('../../../src/plugin-runtime/', import.meta.url));

describe('Agent Host module boundary', () => {
  it('keeps Agent Host implementation files behind the module entry point', async () => {
    const entries = await readdir(pluginRuntimeRoot, { withFileTypes: true });
    const rootSources = entries.filter(entry => entry.isFile() && entry.name.endsWith('.ts'));
    const violations: string[] = [];

    for (const entry of rootSources) {
      const source = await readFile(new URL(`../../../src/plugin-runtime/${entry.name}`, import.meta.url), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\()['"]\.\/agent\/([^'"]+)/gu)) {
        if (match[1] !== 'module.js') violations.push(`${entry.name} -> ${match[1]}`);
      }
    }

    expect(violations).toEqual([]);
    expect(rootSources
      .map(entry => entry.name)
      .filter(name => name.startsWith('agent-')
        || name === 'assistant-runtime.ts'
        || name === 'sandbox-turn-policy.ts'))
      .toEqual([]);
  });
});
