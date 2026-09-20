import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRuntimeRoot = fileURLToPath(new URL('../../../src/plugin-runtime/', import.meta.url));
const consoleRoot = new URL('../../../src/plugin-runtime/console/', import.meta.url);

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
    const consoleSources = await readdir(consoleRoot, { withFileTypes: true });
    expect(consoleSources.some(entry => entry.name === 'projection.ts')).toBe(false);
    expect(consoleSources.some(entry => entry.name === 'agent-introspection.ts')).toBe(false);
    expect(consoleSources.some(entry => entry.name === 'api.ts')).toBe(false);
  });

  it('keeps supporting modules independent from the HTTP API orchestrator', async () => {
    const supportingModules = [
      'agent-console.ts',
      'agent-config-projection.ts',
      'agent-feature-projection.ts',
      'agent-runtime-resolver.ts',
      'api-routes.ts',
      'asset-server.ts',
      'agent-routes.ts',
      'configuration.ts',
      'configuration-projection.ts',
      'console-schema.ts',
      'conversation-session.ts',
      'data-lifecycle-routes.ts',
      'display-path.ts',
      'effect-sponsor-routes.ts',
      'entry-projection.ts',
      'entry-routes.ts',
      'environment-files.ts',
      'events.ts',
      'http-response.ts',
      'inbox.ts',
      'login-assist-binding.ts',
      'message-bindings.ts',
      'page-renderer.ts',
      'portfolio-sponsor-routes.ts',
      'plugin-routes.ts',
      'plugin-package-map.ts',
      'plugin-schema-catalog.ts',
      'plugin-projection.ts',
      'rpc-route.ts',
      'rpc-context.ts',
      'rpc-composition.ts',
      'rpc-extended-context.ts',
      'runtime-snapshot.ts',
      'system-log.ts',
      'system-projection.ts',
      'system-routes.ts',
      'workroom-routes.ts',
      'workroom-request-policy.ts',
      'workroom-run-control-route.ts',
      'workroom-run-query-routes.ts',
      'workroom-run-routes.ts',
      'workroom-governance-routes.ts',
      'workroom-catalog-rpc.ts',
    ];
    const violations: string[] = [];
    for (const file of supportingModules) {
      const source = await readFile(new URL(`../../../src/plugin-runtime/console/${file}`, import.meta.url), 'utf8');
      if (/(?:from\s+|import\()['"]\.\/api-installer\.js['"]/u.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
