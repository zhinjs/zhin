import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRuntimeRoot = fileURLToPath(new URL('../../../src/plugin-runtime/', import.meta.url));

describe('Workroom module boundary', () => {
  it('keeps Workroom implementation files behind the module entry point', async () => {
    const entries = await readdir(pluginRuntimeRoot, { withFileTypes: true });
    const rootSources = entries.filter(entry => entry.isFile() && entry.name.endsWith('.ts'));
    const violations: string[] = [];

    for (const entry of rootSources) {
      const source = await readFile(new URL(`../../../src/plugin-runtime/${entry.name}`, import.meta.url), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\()['"]\.\/workroom\/([^'"]+)/gu)) {
        if (match[1] !== 'module.js') violations.push(`${entry.name} -> ${match[1]}`);
      }
    }

    expect(violations).toEqual([]);
    expect(rootSources
      .map(entry => entry.name)
      .filter(name => name.startsWith('workroom-') || name.startsWith('local-workroom-')))
      .toEqual([]);
  });

  it('lets tests import internal Workroom files only from the documented allowlist', async () => {
    // Each allowlisted file starts with a "保留内部 import 的原因" header comment explaining why the
    // internal coordinator/module cannot be reached through module.ts. New tests must use module.js.
    const allowlist = new Set([
  'acceptance-coordinator.test.ts',
  'assignment-coordinator.test.ts',
  'data-governance-coordinator.test.ts',
  'effect-coordinator.test.ts',
  'execution-control-coordinator.test.ts',
  'execution-coordinator.test.ts',
  'human-ingress-coordinator.test.ts',
  'human-ingress-route.test.ts',
  'knowledge-coordinator.test.ts',
  'local-portfolio.test.ts',
  'persistence-coordinator.test.ts',
  'planning-bootstrap.test.ts',
  'planning-coordinator.test.ts',
  'portfolio-coordinator.test.ts',
  'profile-coordinator.test.ts',
  'projection.test.ts',
  'projection-coordinator.test.ts',
    ]);
    const testsRoot = fileURLToPath(new URL('./', import.meta.url));
    const files = (await readdir(testsRoot)).filter(name => name.endsWith('.test.ts') && name !== 'module-boundary.test.ts');
    const offenders: string[] = [];
    const stale: string[] = [];
    for (const name of files) {
      const source = await readFile(`${testsRoot}${name}`, 'utf8');
      const importsInternal = /src\/plugin-runtime\/workroom\/(?!module\.js)/u.test(source);
      if (importsInternal && !allowlist.has(name)) offenders.push(name);
      if (importsInternal && !source.startsWith('// 保留内部 import 的原因：')) offenders.push(`${name} (missing reason header)`);
      if (!importsInternal && allowlist.has(name)) stale.push(name);
    }
    expect(offenders).toEqual([]);
    expect(stale).toEqual([]);
  });
});
