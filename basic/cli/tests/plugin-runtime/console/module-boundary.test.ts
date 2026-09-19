import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRuntimeRoot = fileURLToPath(new URL('../../../src/plugin-runtime/', import.meta.url));

describe('Console Host module boundary', () => {
  it('keeps Console Host implementation behind the module entry point', async () => {
    const entries = await readdir(pluginRuntimeRoot, { withFileTypes: true });
    const rootSources = entries.filter(entry => entry.isFile() && entry.name.endsWith('.ts'));
    const violations: string[] = [];

    for (const entry of rootSources) {
      const source = await readFile(new URL(`../../../src/plugin-runtime/${entry.name}`, import.meta.url), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\()['"]\.\/console\/([^'"]+)/gu)) {
        if (match[1] !== 'module.js') violations.push(`${entry.name} -> ${match[1]}`);
      }
    }

    expect(violations).toEqual([]);
    expect(rootSources.map(entry => entry.name).filter(name => [
      'console-api-installer.ts',
      'console-host-installer.ts',
      'inbox-installer.ts',
      'log-transport.ts',
      'login-assist-stdin.ts',
    ].includes(name))).toEqual([]);
  });

  it('keeps supporting modules independent from the HTTP API orchestrator', async () => {
    const supportingModules = [
      'agent-console.ts',
      'agent-routes.ts',
      'configuration.ts',
      'data-lifecycle-routes.ts',
      'effect-sponsor-routes.ts',
      'http-response.ts',
      'inbox.ts',
      'portfolio-sponsor-routes.ts',
      'projection.ts',
      'system-log.ts',
      'workroom-routes.ts',
      'workroom-run-routes.ts',
      'workroom-governance-routes.ts',
    ];
    const violations: string[] = [];
    for (const file of supportingModules) {
      const source = await readFile(new URL(`../../../src/plugin-runtime/console/${file}`, import.meta.url), 'utf8');
      if (/(?:from\s+|import\()['"]\.\/api\.js['"]/u.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
